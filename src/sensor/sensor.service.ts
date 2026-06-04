import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SensorDataDto, SensorHistory, SensorSnapshot } from './sensor.dto';
import { SensorReading } from './entities/sensor-reading.entity';
import { ThresholdConfig } from './entities/threshold-config.entity';
import { AlarmEvent } from './entities/alarm-event.entity';
import { SensorBufferService } from './sensor-buffer.service';
import { VibrationWindowService } from './vibration-window.service';

const MAX_HISTORY = 60;
const DEFAULT_DAM_ID = 'dam_1';

@Injectable()
export class SensorService implements OnModuleInit {
  private latest: SensorSnapshot | null = null;

  private history: SensorHistory = {
    timestamps: [],
    freq: [],
    amp: [],
    waterLevel: [],
    moisture: [],
    percent: [],
  };

  constructor(
    @InjectRepository(SensorReading)
    private readonly sensorReadingRepo: Repository<SensorReading>,
    @InjectRepository(ThresholdConfig)
    private readonly thresholdConfigRepo: Repository<ThresholdConfig>,
    @InjectRepository(AlarmEvent)
    private readonly alarmEventRepo: Repository<AlarmEvent>,
    private readonly bufferService: SensorBufferService,
    private readonly vibrationWindowService: VibrationWindowService,
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
    const damId = DEFAULT_DAM_ID;
    const sensorId = 'sensor_node_1';

    // 1. Lấy cấu hình ngưỡng từ database để tính toán động
    const configs = await this.thresholdConfigRepo.find({ where: { damId } });
    const waterConfig = configs.find(c => c.sensorType === 'water_level');
    const vibConfig = configs.find(c => c.sensorType === 'vibration');
    const humConfig = configs.find(c => c.sensorType === 'humidity');

    const tankHeight = waterConfig ? waterConfig.tankHeight : 50.0;
    const calculatedPercent = +((dto.waterLevel / tankHeight) * 100).toFixed(1);

    const snapshot: SensorSnapshot = {
      freq: +dto.freq,
      amp: +dto.amp,
      waterLevel: +dto.waterLevel,
      moisture: +dto.moisture,
      percent: calculatedPercent,
      timestamp: timestamp.toISOString(),
    };

    this.latest = snapshot;
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
          sustainedSeconds: vibConfig.sustainedSeconds,
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
          `Rung động vượt ngưỡng liên tiếp: ${dto.amp} mm/s`
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
        `Mực nước vượt ngưỡng báo động: ${dto.waterLevel} cm`
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
        `Độ ẩm rò rỉ vượt ngưỡng: ${dto.moisture}%`
      );
      if (alarm) newAlarms.push(alarm);
    }

    return { snapshot, alarms: newAlarms };
  }


  getLatest(): SensorSnapshot | null {
    return this.latest;
  }

  getHistory(): SensorHistory {
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
    return this.thresholdConfigRepo.findOneOrFail({ where: { id } });
  }

  // ── Alarm Events API ─────────────────────────────────────────────
  async getAlarmEvents(
    damId: string,
    limit = 50,
    severity?: string,
    resolved?: boolean,
  ): Promise<AlarmEvent[]> {
    const qb = this.alarmEventRepo.createQueryBuilder('a')
      .where('a.damId = :damId', { damId })
      .orderBy('a.triggeredAt', 'DESC')
      .take(limit);

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

    // Nếu là mức CRITICAL hoặc ALERT, chuẩn bị trigger camera AI (sẽ được dispatch sau)
    if (severity === 'ALERT' || severity === 'CRITICAL') {
      event.cameraActivated = true;
    }

    await this.alarmEventRepo.save(event);
    console.log(`[SensorService] ĐÃ TẠO SỰ KIỆN CẢNH BÁO: [${severity}] cho ${sensorType} - Giá trị đo: ${measuredVal}`);
    return event;
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
  }
}

