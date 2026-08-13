import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SensorDataDto, SensorHistory, SensorSnapshot } from './sensor.dto';
import { SensorReading } from './entities/sensor-reading.entity';
import { ThresholdConfig } from './entities/threshold-config.entity';
import { AlarmEvent } from './entities/alarm-event.entity';
import { SensorBufferService } from './sensor-buffer.service';
import { VibrationWindowService } from './vibration-window.service';
import { Station } from '../dam/entities/station.entity';
import { Dam } from '../dam/entities/dam.entity';
import { SensorClusterService } from './sensor-cluster.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import * as nodemailer from 'nodemailer';

const MAX_HISTORY = 60;
const DEFAULT_DAM_ID = 'dam_1';

@Injectable()
export class SensorService implements OnModuleInit {
  private latest: SensorSnapshot | null = null;
  private latestByStation: Map<number, SensorSnapshot> = new Map();
  private latestByCluster: Map<string, SensorSnapshot> = new Map();

  private history: SensorHistory = {
    timestamps: [],
    freq: [],
    amp: [],
    waterLevel: [],
    moisture: [],
    percent: [],
  };

  private historyByStation: Map<number, SensorHistory> = new Map();

  constructor(
    @InjectRepository(SensorReading)
    private readonly sensorReadingRepo: Repository<SensorReading>,
    @InjectRepository(ThresholdConfig)
    private readonly thresholdConfigRepo: Repository<ThresholdConfig>,
    @InjectRepository(AlarmEvent)
    private readonly alarmEventRepo: Repository<AlarmEvent>,
    @InjectRepository(Station)
    private readonly stationRepo: Repository<Station>,
    @InjectRepository(Dam)
    private readonly damRepo: Repository<Dam>,
    private readonly bufferService: SensorBufferService,
    private readonly vibrationWindowService: VibrationWindowService,
    private readonly configService: ConfigService,
    private readonly sensorClusterService: SensorClusterService,
    private readonly auditLogService: AuditLogService,
  ) { }

  // Khởi tạo ngưỡng mặc định khi khởi động ứng dụng nếu chưa tồn tại
  async onModuleInit() {
    console.log('[SensorService] Đang kiểm tra cấu hình ngưỡng mặc định...');
    const types = ['vibration', 'water_level', 'humidity'];

    for (const type of types) {
      const exists = await this.thresholdConfigRepo.findOne({
        where: { damId: DEFAULT_DAM_ID, sensorType: type },
      });

      if (!exists) {
        const config = new ThresholdConfig();
        config.damId = DEFAULT_DAM_ID;
        config.sensorType = type;

        if (type === 'vibration') {
          config.warnLow = 0;
          config.warnHigh = 2.5;
          config.alertLow = 2.5;
          config.alertHigh = 15.0;
          config.criticalHigh = 25.0;
          config.sustainedSeconds = 3;
        } else if (type === 'water_level') {
          config.warnLow = 0;
          config.warnHigh = 42.5; // 85%
          config.alertLow = 42.5;
          config.alertHigh = 50.0; // 100%
          config.criticalHigh = 55.0;
          config.tankHeight = 50.0;
        } else { // humidity
          config.warnLow = 0;
          config.warnHigh = 75.0;
          config.alertLow = 75.0;
          config.alertHigh = 85.0;
          config.criticalHigh = 95.0;
        }

        await this.thresholdConfigRepo.save(config);
        console.log(`[SensorService] Đã tạo cấu hình ngưỡng mặc định cho cảm biến: ${type}`);
      }
    }
  }

  async ingest(dto: SensorDataDto): Promise<{ snapshot: SensorSnapshot; alarms: AlarmEvent[] }> {
    const timestamp = new Date();
    let damId = dto.damId || DEFAULT_DAM_ID;
    const sensorId = dto.clusterId || 'sensor_node_1';
    let stationId: number | undefined = dto.stationId;

    // 1. Nếu có clusterId, tra cứu Cụm cảm biến để tìm Trạm (Station) và Đập (Dam) tương ứng
    if (dto.clusterId) {
      await this.sensorClusterService.updateOnlineStatus(dto.clusterId, timestamp);
      try {
        const cluster = await this.sensorClusterService.findById(dto.clusterId);
        if (cluster) {
          stationId = cluster.stationId;
          if (cluster.station && cluster.station.damId) {
            damId = cluster.station.damId;
          }

          // Cập nhật thông số thời gian thực vào bảng Trạm (Station)
          await this.stationRepo.update(cluster.stationId, {
            waterLevel: +dto.waterLevel,
            humidity: +dto.moisture,
            bd3: +dto.amp, // Lưu biên độ rung vào chỉ số bd3 của trạm
          });
        }
      } catch (err) {
        // Cụm chưa đăng ký trong DB — tiếp tục fallback mặc định
      }
    }

    // 2. Lấy cấu hình ngưỡng từ database để tính toán động
    const configs = await this.thresholdConfigRepo.find({ where: { damId } });
    const waterConfig = configs.find(c => c.sensorType === 'water_level');
    const vibConfig = configs.find(c => c.sensorType === 'vibration');
    const humConfig = configs.find(c => c.sensorType === 'humidity');

    const tankHeight = waterConfig ? waterConfig.tankHeight : 50.0;
    const calculatedPercent = +((dto.waterLevel / tankHeight) * 100).toFixed(1);

    const snapshot: SensorSnapshot = {
      clusterId: dto.clusterId,
      stationId,
      damId,
      freq: +dto.freq,
      amp: +dto.amp,
      waterLevel: +dto.waterLevel,
      moisture: +dto.moisture,
      percent: calculatedPercent,
      timestamp: timestamp.toISOString(),
    };

    this.latest = snapshot;
    if (stationId) {
      this.latestByStation.set(stationId, snapshot);
    }
    if (dto.clusterId) {
      this.latestByCluster.set(dto.clusterId, snapshot);
    }
    this.pushHistory(snapshot);

    // 2. Gom nhóm dữ liệu ghi vào database qua buffer (TimescaleDB)
    const readingsToInsert: SensorReading[] = [
      this.createReading(timestamp, sensorId, 'vibration_freq', dto.freq, 'Hz', damId),
      this.createReading(timestamp, sensorId, 'vibration_amp', dto.amp, 'mm/s', damId),
      this.createReading(timestamp, sensorId, 'water_level', dto.waterLevel, 'cm', damId),
      this.createReading(timestamp, sensorId, 'moisture', dto.moisture, '%', damId),
    ];

    readingsToInsert.forEach(reading => this.bufferService.push(reading));

    // 3. Đánh giá ngưỡng cảnh báo & Tạo AlarmEvent — thu thập để broadcast
    const newAlarms: AlarmEvent[] = [];

    if (vibConfig) {
      const vibResult = this.vibrationWindowService.evaluate(
        sensorId,
        dto.amp,
        timestamp,
        {
          alertHigh: vibConfig.alertHigh,
          criticalHigh: vibConfig.criticalHigh,
          warnHigh: vibConfig.warnHigh,
          alertMinCount: 4
        }
      );

      if (vibResult.breach) {
        const alarm = await this.createAlarmEvent(
          damId,
          sensorId,
          'vibration',
          vibResult.severity,
          vibConfig.alertHigh,
          dto.amp,
          Math.round(vibResult.durationMs / 1000),
          `Rung động vượt ngưỡng liên tiếp: ${dto.amp} mm/s`,
          stationId
        );
        if (alarm) newAlarms.push(alarm);
      }
    }

    if (waterConfig && dto.waterLevel >= waterConfig.alertHigh) {
      const severity = dto.waterLevel >= waterConfig.criticalHigh ? 'CRITICAL' : 'ALERT';
      const alarm = await this.createAlarmEvent(
        damId,
        sensorId,
        'water_level',
        severity,
        waterConfig.alertHigh,
        dto.waterLevel,
        0,
        `Mực nước vượt ngưỡng báo động: ${dto.waterLevel} cm`,
        stationId
      );
      if (alarm) newAlarms.push(alarm);
    }

    if (humConfig && dto.moisture >= humConfig.alertHigh) {
      const severity = dto.moisture >= humConfig.criticalHigh ? 'CRITICAL' : 'ALERT';
      const alarm = await this.createAlarmEvent(
        damId,
        sensorId,
        'humidity',
        severity,
        humConfig.alertHigh,
        dto.moisture,
        0,
        `Độ ẩm rò rỉ vượt ngưỡng: ${dto.moisture}%`,
        stationId
      );
      if (alarm) newAlarms.push(alarm);
    }

    return { snapshot, alarms: newAlarms };
  }


  getLatest(stationId?: number, clusterId?: string): SensorSnapshot | null {
    if (stationId && this.latestByStation.has(stationId)) {
      return this.latestByStation.get(stationId)!;
    }
    if (clusterId && this.latestByCluster.has(clusterId)) {
      return this.latestByCluster.get(clusterId)!;
    }
    return this.latest;
  }

  getHistory(stationId?: number): SensorHistory {
    if (stationId && this.historyByStation.has(stationId)) {
      return this.historyByStation.get(stationId)!;
    }
    return this.history;
  }

  // Lấy lịch sử dữ liệu thực tế từ TimescaleDB (cho Frontend hiển thị biểu đồ dài hạn)
  async getLongTermHistory(sensorType: string, limit = 100): Promise<any[]> {
    return this.sensorReadingRepo.find({
      where: { sensorType },
      order: { time: 'DESC' },
      take: limit,
    });
  }

  // Quản lý cấu hình ngưỡng
  async getThresholdConfigs(damId: string): Promise<ThresholdConfig[]> {
    return this.thresholdConfigRepo.find({ where: { damId } });
  }

  async updateThresholdConfig(id: string, update: Partial<ThresholdConfig>): Promise<ThresholdConfig> {
    await this.thresholdConfigRepo.update(id, update);
    const updated = await this.thresholdConfigRepo.findOneOrFail({ where: { id } });

    await this.auditLogService.logAction({
      action: 'UPDATE_THRESHOLD',
      category: 'THRESHOLD',
      description: `Thay đổi cấu hình ngưỡng báo động [${updated.sensorType.toUpperCase()}] đập ${updated.damId} (Warn: ${updated.warnHigh}, Alert: ${updated.alertHigh}, Critical: ${updated.criticalHigh})`,
      username: 'admin',
      userRole: 'ADMIN',
      metadata: updated,
    });

    return updated;
  }

  // ── Alarm Events API ─────────────────────────────────────────────
  async getAlarmEvents(
    damId?: string,
    limit = 50,
    severity?: string,
    resolved?: boolean,
  ): Promise<AlarmEvent[]> {
    const qb = this.alarmEventRepo.createQueryBuilder('a')
      .orderBy('a.triggeredAt', 'DESC')
      .take(limit);

    if (damId && damId !== 'all') {
      qb.andWhere('a.damId = :damId', { damId });
    }

    if (severity) {
      qb.andWhere('a.severity = :severity', { severity });
    }
    if (resolved === true) {
      qb.andWhere('a.resolvedAt IS NOT NULL');
    } else if (resolved === false) {
      qb.andWhere('a.resolvedAt IS NULL');
    }

    return qb.getMany();
  }

  async resolveAlarmEvent(id: string): Promise<AlarmEvent> {
    await this.alarmEventRepo.update(id, { resolvedAt: new Date() });
    return this.alarmEventRepo.findOneOrFail({ where: { id } });
  }

  async updateAlarmEventAiResult(
    id: string,
    update: { crackDetected: boolean; crackConfidence: number; imageUrl: string }
  ): Promise<AlarmEvent> {
    await this.alarmEventRepo.update(id, {
      crackDetected: update.crackDetected,
      crackConfidence: update.crackConfidence,
      imageUrl: update.imageUrl,
    });
    return this.alarmEventRepo.findOneOrFail({ where: { id } });
  }

  private createReading(
    time: Date,
    sensorId: string,
    sensorType: string,
    value: number,
    unit: string,
    damId: string,
  ): SensorReading {
    const r = new SensorReading();
    r.time = time;
    r.sensorId = sensorId;
    r.sensorType = sensorType;
    r.value = value;
    r.unit = unit;
    r.damId = damId;
    return r;
  }

  // Trả về AlarmEvent nếu tạo thành công, null nếu bị de-dupe
  async createAlarmEvent(
    damId: string,
    sensorId: string,
    sensorType: string,
    severity: string,
    thresholdVal: number,
    measuredVal: number,
    durationS: number,
    notes: string,
    stationId?: number,
  ): Promise<AlarmEvent | null> {
    // Để tránh spam nhiều sự kiện cảnh báo trùng lặp liên tục trong thời gian ngắn,
    // ta chỉ tạo cảnh báo mới nếu sự kiện trước đó cách đây quá 1 phút hoặc đã được resolved.
    const lastEvent = await this.alarmEventRepo.findOne({
      where: { damId, sensorId, sensorType, severity },
      order: { triggeredAt: 'DESC' },
    });

    const DE_DUPE_INTERVAL = 5 * 1000; // Đặt 5 giây để dễ test trong quá trình phát triển (mặc định là 60 giây)
    if (lastEvent && (new Date().getTime() - lastEvent.triggeredAt.getTime() < DE_DUPE_INTERVAL) && !lastEvent.resolvedAt) {
      // Bỏ qua không tạo thêm event để tránh spam
      return null;
    }

    const event = new AlarmEvent();
    event.damId = damId;
    event.sensorId = sensorId;
    event.sensorType = sensorType;
    event.severity = severity;
    event.thresholdVal = thresholdVal;
    event.measuredVal = measuredVal;
    event.durationS = durationS;
    event.notes = notes;
    if (stationId) event.stationId = stationId;

    // Tra cứu và điền chính xác Tên Trạm, Tên Đập và Vị trí thực tế
    try {
      let station: Station | null = null;
      if (stationId) {
        station = await this.stationRepo.findOne({ where: { id: stationId }, relations: { dam: true } });
      }
      let dam: Dam | null = null;
      const targetDamId = damId || station?.damId;
      if (targetDamId) {
        dam = await this.damRepo.findOne({ where: { id: targetDamId } });
      }

      event.stationName = station?.name || (stationId ? `Trạm ${stationId}` : '');
      event.damName = dam?.name || station?.dam?.name || (damId ? `Đập ${damId}` : '');
      event.location = station?.location || station?.km || dam?.location || 'Vị trí công trình đập';
    } catch (err: any) {
      console.log('[SensorService] Lỗi tra cứu thông tin Trạm/Đập:', err.message);
    }

    // Chỉ kích hoạt Camera AI khi cảnh báo về ĐỘ RUNG ở mức ALERT hoặc CRITICAL
    if (sensorType === 'vibration' && (severity === 'ALERT' || severity === 'CRITICAL')) {
      event.cameraActivated = true;
    }

    await this.alarmEventRepo.save(event);
    console.log(`[SensorService] ĐÃ TẠO SỰ KIỆN CẢNH BÁO: [${severity}] cho ${sensorType} tại [${event.stationName || stationId || 'Trạm Quan Trắc'}] - Đập [${event.damName || damId}]`);

    if (event.cameraActivated) {
      this.triggerAiCamera(event);
    }

    return event;
  }

  async triggerAiCamera(alarm: AlarmEvent) {
    let jetsonUrl = this.configService.get<string>('JETSON_TX2_URL', 'http://localhost:8080');

    if (alarm.damId) {
      try {
        const dam = await this.damRepo.findOne({ where: { id: alarm.damId } });
        if (dam?.cameraUrl) {
          jetsonUrl = dam.cameraUrl;
        }
      } catch (err) {
        console.log('[SensorService] Lỗi tìm cameraUrl của đập:', err.message);
      }
    }

    const cameraUrl = `${jetsonUrl}/camera/trigger-inference`;

    console.log(`[SensorService] Đang gửi lệnh kích hoạt Camera AI tới [${alarm.damId || 'N/A'}]: ${cameraUrl} cho sự kiện cảnh báo ${alarm.id}`);

    fetch(cameraUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alarmId: alarm.id,
        damId: alarm.damId,
        damName: alarm.damName,
        stationId: alarm.stationId,
        stationName: alarm.stationName,
        location: alarm.location,
        sensorId: alarm.sensorId,
        sensorType: alarm.sensorType,
        measuredValue: alarm.measuredVal,
        severity: alarm.severity,
        timestamp: alarm.triggeredAt,
      }),
    }).catch(err => {
      console.log('[SensorService] Lỗi kích hoạt Camera AI:', err.message);
    });
  }

  private pushHistory(s: SensorSnapshot) {
    const h = this.history;
    h.timestamps.push(s.timestamp);
    h.freq.push(s.freq);
    h.amp.push(s.amp);
    h.waterLevel.push(s.waterLevel);
    h.moisture.push(s.moisture);
    h.percent.push(s.percent);

    if (h.timestamps.length > MAX_HISTORY) {
      (Object.keys(h) as (keyof SensorHistory)[]).forEach((k) =>
        (h[k] as any[]).shift(),
      );
    }

    if (s.stationId) {
      if (!this.historyByStation.has(s.stationId)) {
        this.historyByStation.set(s.stationId, {
          timestamps: [],
          freq: [],
          amp: [],
          waterLevel: [],
          moisture: [],
          percent: [],
        });
      }
      const stH = this.historyByStation.get(s.stationId)!;
      stH.timestamps.push(s.timestamp);
      stH.freq.push(s.freq);
      stH.amp.push(s.amp);
      stH.waterLevel.push(s.waterLevel);
      stH.moisture.push(s.moisture);
      stH.percent.push(s.percent);

      if (stH.timestamps.length > MAX_HISTORY) {
        (Object.keys(stH) as (keyof SensorHistory)[]).forEach((k) =>
          (stH[k] as any[]).shift(),
        );
      }
    }
  }

  async sendEmailAlert(payload: {
    toEmail: string | string[];
    subject?: string;
    message: string;
    alarmId?: string;
  }): Promise<{ success: boolean; message: string }> {
    const host = this.configService.get<string>('SMTP_HOST', 'smtp.gmail.com');
    const port = this.configService.get<number>('SMTP_PORT', 587);
    const user = this.configService.get<string>('SMTP_USER', '');
    const pass = this.configService.get<string>('SMTP_PASS', '');

    let rawEmail = payload.toEmail;
    if (Array.isArray(rawEmail)) {
      rawEmail = rawEmail.filter(e => Boolean(e && e.trim())).join(', ');
    }
    const targetEmail = rawEmail || this.configService.get<string>('DEFAULT_ALERT_EMAIL', 'ruka13312002@gmail.com');
    const emailSubject = payload.subject || `[CẢNH BÁO KHẨN CẤP] Thông báo chỉ đạo từ Ban Quản lý Hồ Đập`;

    // Tìm thông tin sự kiện cảnh báo từ DB nếu có alarmId
    let alarmInfo: AlarmEvent | null = null;
    if (payload.alarmId) {
      try {
        alarmInfo = await this.alarmEventRepo.findOne({ where: { id: payload.alarmId } });
      } catch (e) {
        console.warn('[SensorService] Không thể tải thông tin alarmId:', payload.alarmId);
      }
    }

    const locationText = alarmInfo
      ? `Trạm ${alarmInfo.sensorId === 'sensor_node_1' ? 'K25+500 (Thân đập chính Đan Phượng)' : alarmInfo.sensorId} - Đập ${alarmInfo.damId}`
      : 'Trạm K25+500 - Thân đập chính Đan Phượng (sensor_node_1)';

    console.log(`[SensorService] Đang chuẩn bị gửi Email cảnh báo tới: ${targetEmail} cho vị trí: ${locationText}`);

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #dc2626; color: #ffffff; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">🚨 CẢNH BÁO AN TOÀN HỒ ĐẬP</h1>
          <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Hệ thống Giám sát & Điều hành Khẩn cấp Hồ đập Thủy lợi</p>
        </div>
        <div style="padding: 24px;">
          <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 14px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #991b1b; font-weight: bold; font-size: 14px;">Thông điệp chỉ đạo từ Admin Trực ban:</p>
            <p style="margin: 8px 0 0 0; color: #7f1d1d; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${payload.message}</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px;">
            <tr style="border-bottom: 1px solid #f0f0f0;">
              <td style="padding: 10px; font-weight: bold; color: #555; width: 40%;">📍 Địa điểm đặt cảm biến:</td>
              <td style="padding: 10px; color: #dc2626; font-weight: bold;">${locationText}</td>
            </tr>
            ${alarmInfo ? `
            <tr style="border-bottom: 1px solid #f0f0f0;">
              <td style="padding: 10px; font-weight: bold; color: #555;">📊 Thông số đo được:</td>
              <td style="padding: 10px; color: #111; font-weight: bold;">${alarmInfo.sensorType.toUpperCase()}: ${alarmInfo.measuredVal} (Ngưỡng: ${alarmInfo.thresholdVal})</td>
            </tr>
            <tr style="border-bottom: 1px solid #f0f0f0;">
              <td style="padding: 10px; font-weight: bold; color: #555;">⚠️ Mức độ cảnh báo:</td>
              <td style="padding: 10px; color: #dc2626; font-weight: bold;">${alarmInfo.severity}</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #f0f0f0;">
              <td style="padding: 10px; font-weight: bold; color: #555;">🕒 Thời điểm ghi nhận:</td>
              <td style="padding: 10px; color: #111;">${new Date().toLocaleString('vi-VN')}</td>
            </tr>
            
          </table>
          <div style="text-align: center; margin-top: 25px;">
            <a href="http://localhost:3000/alerts" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; font-size: 13px; border-radius: 6px; display: inline-block;">TRUY CẬP BẢN ĐỒ GIÁM SÁT VỊ TRÍ</a>
          </div>
        </div>
        <div style="background-color: #f9fafb; padding: 14px; text-align: center; font-size: 11px; color: #6b7280; border-top: 1px solid #f0f0f0;">
          Email tự động từ Hệ thống Cảnh báo Hồ đập Thủy lợi.
        </div>
      </div>
    `;

    try {
      if (!user || pass === 'app_password_here') {
        console.warn('[SensorService] SMTP chưa được cấu hình mật khẩu thực tế trong .env. Đã ghi nhận lệnh gửi email giả lập thành công.');
        return {
          success: true,
          message: `Đã giả lập gửi Email thành công tới ${targetEmail} (Vui lòng cấu hình SMTP_PASS trong .env để gửi Email thật).`,
        };
      }

      const info = await transporter.sendMail({
        from: `"Hệ thống Giám sát Hồ đập" <${user}>`,
        to: targetEmail,
        subject: emailSubject,
        html: htmlBody,
      });

      console.log(`[SensorService] Đã gửi Email thành công! MessageId: ${info.messageId}`);
      return {
        success: true,
        message: `Đã gửi Email cảnh báo thành công tới ${targetEmail}!`,
      };
    } catch (err: any) {
      console.error('[SensorService] Lỗi khi gửi Email qua SMTP:', err);
      return {
        success: false,
        message: `Không thể gửi Email: ${err.message || 'Lỗi kết nối máy chủ SMTP'}`,
      };
    }
  }
}


