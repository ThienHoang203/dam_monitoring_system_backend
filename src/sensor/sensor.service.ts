import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SensorDataDto, SensorHistory, SensorSnapshot } from './sensor.dto';
import { SensorReading } from './entities/sensor-reading.entity';
import { ThresholdConfig } from './entities/threshold-config.entity';
import { AlarmEvent } from './entities/alarm-event.entity';
import { SensorBufferService } from './sensor-buffer.service';
import { Station } from '../dam/entities/station.entity';
import { Dam } from '../dam/entities/dam.entity';
import { Gateway } from '../gateway/entities/gateway.entity';
import { Node } from '../node/entities/node.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import * as nodemailer from 'nodemailer';

const MAX_HISTORY = 60;
const DEFAULT_DAM_ID = 'dam_1';

@Injectable()
export class SensorService implements OnModuleInit {
  private latest: SensorSnapshot | null = null;
  private latestByStation: Map<number, SensorSnapshot> = new Map();
  private latestByNode: Map<string, SensorSnapshot> = new Map();

  private thresholdConfigCache: Map<string, ThresholdConfig[]> = new Map();
  private stationDeviceCache: Map<string, { stationId: number; damId: string }> = new Map();

  private nodeStateCache: Map<string, {
    freq: number;
    amp: number;
    waterLevel: number;
    moisture: number;
    stationId?: number;
    damId?: string;
  }> = new Map();

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
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
    private readonly bufferService: SensorBufferService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) { }

  // Khởi tạo ngưỡng mặc định & nạp cache khi khởi động ứng dụng
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

    // Warm-up cache bộ nhớ cho ThresholdConfigs và Mappings
    await this.preloadCache();
  }

  private async preloadCache() {
    try {
      const configs = await this.thresholdConfigRepo.find();
      const grouped = new Map<string, ThresholdConfig[]>();
      for (const c of configs) {
        const list = grouped.get(c.damId) || [];
        list.push(c);
        grouped.set(c.damId, list);
      }
      this.thresholdConfigCache = grouped;

      const gateways = await this.gatewayRepo.find({ relations: { station: true } });
      for (const gw of gateways) {
        if (gw.stationId) {
          this.stationDeviceCache.set(gw.id, {
            stationId: gw.stationId,
            damId: gw.station?.damId || DEFAULT_DAM_ID,
          });
        }
      }

      const nodes = await this.nodeRepo.find({ relations: { gateway: { station: true } } });
      for (const node of nodes) {
        if (node.gateway && node.gateway.stationId) {
          this.stationDeviceCache.set(node.id, {
            stationId: node.gateway.stationId,
            damId: node.gateway.station?.damId || DEFAULT_DAM_ID,
          });
        }
      }
    } catch (err: any) {
      console.warn('[SensorService] Lỗi khi nạp cache:', err.message);
    }
  }

  /**
   * Cập nhật ngay lập tức liên kết Node -> Station/Dam trong memory cache.
   * Chuyển hướng tức thì toàn bộ luồng data cảm biến của Node sang Station mới.
   */
  updateNodeStationMapping(nodeId: string, stationId: number, damId?: string) {
    const targetDamId = damId || DEFAULT_DAM_ID;
    this.stationDeviceCache.set(nodeId, {
      stationId,
      damId: targetDamId,
    });

    const state = this.nodeStateCache.get(nodeId);
    if (state) {
      state.stationId = stationId;
      state.damId = targetDamId;
    }

    console.log(
      `[SensorService] Đã chuyển luồng dữ liệu của Node ${nodeId} sang Trạm (Station ${stationId}) - Đập (${targetDamId})`,
    );
  }

  async getNodeStationInfo(nodeId: string, gatewayId?: string): Promise<{ stationId: number; damId: string }> {
    let cached = this.stationDeviceCache.get(nodeId);
    if (cached) return cached;
    if (gatewayId) {
      cached = this.stationDeviceCache.get(gatewayId);
      if (cached) return cached;
    }

    try {
      const node = await this.nodeRepo.findOne({
        where: { id: nodeId },
        relations: { gateway: { station: true } },
      });
      if (node?.gateway?.stationId) {
        const info = {
          stationId: node.gateway.stationId,
          damId: node.gateway.station?.damId || DEFAULT_DAM_ID,
        };
        this.stationDeviceCache.set(nodeId, info);
        return info;
      }
    } catch {
      // ignore
    }

    return { stationId: 1, damId: DEFAULT_DAM_ID };
  }

  async ingest(dto: SensorDataDto): Promise<{ snapshot: SensorSnapshot; alarms: AlarmEvent[] }> {
    const timestamp = new Date();
    let damId = dto.damId || DEFAULT_DAM_ID;
    const sensorId = dto.clusterId || 'sensor_node_1';
    let stationId: number | undefined = dto.stationId;

    // 1. Nhanh 0ms tra cứu Trạm (Station) và Đập (Dam) từ Cache bộ nhớ
    if (dto.clusterId) {
      const cached = this.stationDeviceCache.get(dto.clusterId);
      if (cached) {
        stationId = cached.stationId;
        damId = cached.damId;
      }

      // Cập nhật online status & thông số Trạm bất đồng bộ (không block WebSocket)
      this.nodeRepo.update(dto.clusterId, { status: 'online', lastSeenAt: timestamp }).catch(() => {});
      if (stationId) {
        this.stationRepo.update(stationId, {
          waterLevel: +dto.waterLevel,
          humidity: +dto.moisture,
          bd3: +dto.amp,
        }).catch(() => {});
      }
    }

    // Fallback stationId nếu chưa có
    if (!stationId) stationId = 1;

    // 2. Lấy cấu hình ngưỡng từ memory cache (0ms)
    let configs = this.thresholdConfigCache.get(damId);
    if (!configs || configs.length === 0) {
      configs = await this.thresholdConfigRepo.find({ where: { damId } });
      this.thresholdConfigCache.set(damId, configs);
    }

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
      this.latestByNode.set(dto.clusterId, snapshot);
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

    // Ghi chú: Logic kiểm tra vượt ngưỡng độ rung và tự động tạo AlarmEvent từ telemetry đã được LOẠI BỎ ở Backend.
    // Việc kiểm tra vượt ngưỡng độ rung, chụp ảnh AI và phát sự kiện cảnh báo độ rung hoàn toàn do Jetson TX2 (main.py) tại hiện trường đảm nhiệm.
    // Backend chỉ đóng vai trò tiếp nhận sự kiện Anomaly từ Jetson qua MQTT (handleAnomalyEvent) và nhận ảnh bằng chứng qua POST /evidence/upload.

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

  /**
   * Parse payload MQTT linh hoạt (Object, string JSON, number, raw text)
   */
  private parseTelemetryPayload(raw: any): any {
    if (raw === null || raw === undefined) return {};
    if (typeof raw === 'number') return { value: raw };
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      try {
        return JSON.parse(trimmed);
      } catch {
        const num = parseFloat(trimmed);
        if (!isNaN(num)) return { value: num };
        return { raw: trimmed };
      }
    }
    return raw;
  }

  /**
   * Xử lý nhận dữ liệu cảm biến từng loại (vibration, water_level, moisture) từ topic:
   * telemetry/gateway/{gateway_id}/node/{node_id}/{sensor_type}
   */
  async ingestSingleTelemetry(
    gatewayId: string,
    nodeId: string,
    sensorType: string,
    rawPayload: any,
  ): Promise<{ snapshot: SensorSnapshot; alarms: AlarmEvent[] }> {
    const payload = this.parseTelemetryPayload(rawPayload);
    const key = nodeId || gatewayId || 'default';

    // 1. Lấy hoặc tạo cache lưu trạng thái gần nhất của Node/Gateway này
    let state = this.nodeStateCache.get(key);
    if (!state) {
      state = {
        freq: this.latest?.freq || 0,
        amp: this.latest?.amp || 0,
        waterLevel: this.latest?.waterLevel || 0,
        moisture: this.latest?.moisture || 0,
        damId: DEFAULT_DAM_ID,
      };
      this.nodeStateCache.set(key, state);
    }

    const typeLower = (sensorType || '').toLowerCase();

    // 2. Parse thông số cảm biến tương ứng
    if (typeLower === 'vibration') {
      if (payload.amp !== undefined) state.amp = +payload.amp;
      else if (payload.value !== undefined) state.amp = +payload.value;
      else if (payload.val !== undefined) state.amp = +payload.val;

      if (payload.freq !== undefined) state.freq = +payload.freq;
    } else if (typeLower === 'water_level' || typeLower === 'waterlevel' || typeLower === 'water') {
      if (payload.waterLevel !== undefined) state.waterLevel = +payload.waterLevel;
      else if (payload.water_level !== undefined) state.waterLevel = +payload.water_level;
      else if (payload.value !== undefined) state.waterLevel = +payload.value;
      else if (payload.val !== undefined) state.waterLevel = +payload.val;
    } else if (typeLower === 'moisture' || typeLower === 'humidity' || typeLower === 'humid') {
      if (payload.moisture !== undefined) state.moisture = +payload.moisture;
      else if (payload.humidity !== undefined) state.moisture = +payload.humidity;
      else if (payload.value !== undefined) state.moisture = +payload.value;
      else if (payload.val !== undefined) state.moisture = +payload.val;
    } else {
      // Trường hợp payload tổng hoặc loại cảm biến khác
      if (payload.freq !== undefined) state.freq = +payload.freq;
      if (payload.amp !== undefined) state.amp = +payload.amp;
      if (payload.waterLevel !== undefined) state.waterLevel = +payload.waterLevel;
      if (payload.water_level !== undefined) state.waterLevel = +payload.water_level;
      if (payload.moisture !== undefined) state.moisture = +payload.moisture;
      if (payload.humidity !== undefined) state.moisture = +payload.humidity;
    }

    // 3. Cập nhật trạng thái 'online' và lastSeenAt cho Gateway & Node trong DB
    const now = new Date();
    if (gatewayId) {
      this.gatewayRepo.update(gatewayId, { status: 'online', lastSeenAt: now }).catch(() => {});
    }
    if (nodeId) {
      this.nodeRepo.update(nodeId, { status: 'online', lastSeenAt: now }).catch(() => {});
    }

    // 4. Tra cứu trạm (stationId) cập nhật mới nhất từ memory cache
    const stationInfo = await this.getNodeStationInfo(nodeId, gatewayId);
    state.stationId = stationInfo.stationId;
    state.damId = stationInfo.damId;

    const dto = new SensorDataDto(
      state.freq,
      state.amp,
      state.waterLevel,
      state.moisture,
      undefined,
      key,
      state.stationId,
      state.damId || DEFAULT_DAM_ID,
    );

    return this.ingest(dto);
  }

  getLatest(stationId?: number, clusterId?: string): SensorSnapshot | null {
    if (stationId && this.latestByStation.has(stationId)) {
      return this.latestByStation.get(stationId)!;
    }
    if (clusterId && this.latestByNode.has(clusterId)) {
      return this.latestByNode.get(clusterId)!;
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

    this.thresholdConfigCache.delete(updated.damId);
    const configs = await this.thresholdConfigRepo.find({ where: { damId: updated.damId } });
    this.thresholdConfigCache.set(updated.damId, configs);

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

    // Chỉ kích hoạt cờ Camera AI khi cảnh báo về ĐỘ RUNG ở mức ALERT hoặc CRITICAL
    if (sensorType === 'vibration' && (severity === 'ALERT' || severity === 'CRITICAL')) {
      event.cameraActivated = true;
    }

    await this.alarmEventRepo.save(event);
    console.log(`[SensorService] ĐÃ TẠO SỰ KIỆN CẢNH BÁO: [${severity}] cho ${sensorType} tại [${event.stationName || stationId || 'Trạm Quan Trắc'}] - Đập [${event.damName || damId}]`);

    // Ghi chú: Không tự động gửi HTTP POST triggerAiCamera() ở đây để tránh kích hoạt kép (double trigger)
    // Jetson TX2 Edge Gateway đã tự động kiểm tra độ rung tại chỗ, tự chụp ảnh & chạy YOLO AI,
    // sau đó gửi kết quả qua MQTT events/gateway/.../anomaly và POST /evidence/upload.

    return event;
  }

  /**
   * Handle anomaly events published by Jetson TX2 via Cloud MQTT
   * Topic: events/gateway/{gateway_id}/anomaly
   */
  async handleAnomalyEvent(payload: {
    event_id?: string;
    eventId?: string;
    gateway_id: string;
    node_id: string;
    camera_id?: string;
    severity?: string;
    measured_val?: number;
    measuredVal?: number;
    duration_sec?: number;
    crack_detected?: boolean;
    confidence: number;
    crack_size?: number;
    timestamp?: string;
  }): Promise<AlarmEvent> {
    const eventId = payload.event_id || payload.eventId;
    const isCrack = payload.crack_detected ?? false;
    const measuredVal = payload.measured_val ?? payload.measuredVal ?? (payload.crack_size && payload.crack_size > 0 ? payload.crack_size : 0);
    const severity = isCrack
      ? 'CRITICAL'
      : (payload.severity || 'ALERT');

    console.log(
      `[SensorService] Nhận sự kiện Anomaly từ Gateway ${payload.gateway_id} / Node ${payload.node_id} (eventId: ${eventId || 'N/A'}, MeasuredVal: ${measuredVal} mm/s, Severity: ${severity}, Crack: ${isCrack})`,
    );

    // 1. Resolve target damId from node or gateway relations
    let targetDamId = DEFAULT_DAM_ID;
    let targetThreshold = 15.0;
    if (payload.node_id) {
      try {
        const node = await this.nodeRepo.findOne({
          where: { id: payload.node_id },
          relations: { gateway: { station: true } },
        });
        if (node?.gateway?.station?.damId) {
          targetDamId = node.gateway.station.damId;
        }
        if (node?.vibrationThreshold != null) {
          targetThreshold = node.vibrationThreshold;
        }
      } catch (err: any) {
        console.warn('[SensorService] Lỗi tra cứu damId theo node:', err.message);
      }
    } else if (payload.gateway_id) {
      try {
        const gw = await this.gatewayRepo.findOne({
          where: { id: payload.gateway_id },
          relations: { station: true },
        });
        if (gw?.station?.damId) {
          targetDamId = gw.station.damId;
        }
      } catch (err: any) {
        console.warn('[SensorService] Lỗi tra cứu damId theo gateway:', err.message);
      }
    }

    // 2. Tìm AlarmEvent theo eventId duy nhất của sự cố
    let event: AlarmEvent | null = null;
    if (eventId) {
      event = await this.alarmEventRepo.findOne({ where: { eventId } });
    }

    if (!event) {
      // Tìm AlarmEvent vừa mới được tạo trong 30s chưa có kết quả AI
      const recentCutoff = new Date(Date.now() - 30 * 1000);
      event = await this.alarmEventRepo.findOne({
        where: {
          sensorId: payload.node_id,
          triggeredAt: MoreThan(recentCutoff),
        },
        order: { triggeredAt: 'DESC' },
      });
    }

    if (event) {
      // Ghép dữ liệu AI từ MQTT vào AlarmEvent hiện có
      if (eventId && !event.eventId) event.eventId = eventId;
      event.crackDetected = isCrack;
      event.crackConfidence = payload.confidence;
      if (measuredVal > 0) {
        event.measuredVal = measuredVal;
      }
      event.severity = severity;
      event.notes = isCrack
        ? `Phát hiện vết nứt bằng YOLO AI trên Jetson TX2 (${payload.gateway_id}). Confidence: ${(payload.confidence * 100).toFixed(1)}%`
        : `Camera AI trên Jetson TX2 (${payload.gateway_id}) đã kiểm tra - Không phát hiện vết nứt. Confidence: ${(payload.confidence * 100).toFixed(1)}%`;
      console.log(`[SensorService] Đã ghép thành công dữ liệu AI vào Alarm ${event.id} (eventId: ${eventId || 'N/A'}, MeasuredVal: ${event.measuredVal})`);
    } else {
      // MQTT đến trước và chưa có alarm nào từ cảm biến -> Tạo mới AlarmEvent
      event = new AlarmEvent();
      event.eventId = eventId || undefined;
      event.damId = targetDamId;
      event.sensorId = payload.node_id || 'NOD-ST01-ESP01';
      event.sensorType = 'vibration';
      event.severity = severity;
      event.thresholdVal = targetThreshold;
      event.measuredVal = measuredVal;
      event.crackDetected = isCrack;
      event.crackConfidence = payload.confidence;
      event.cameraActivated = true;
      event.notes = isCrack
        ? `Phát hiện vết nứt bằng YOLO AI trên Jetson TX2 (${payload.gateway_id}). Confidence: ${(payload.confidence * 100).toFixed(1)}%`
        : `Camera AI trên Jetson TX2 (${payload.gateway_id}) đã kiểm tra - Không phát hiện vết nứt. Confidence: ${(payload.confidence * 100).toFixed(1)}%`;
    }

    await this.alarmEventRepo.save(event);
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


