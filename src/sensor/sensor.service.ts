import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
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
import { Evidence } from '../evidence/entities/evidence.entity';
import { User } from '../auth/entities/user.entity';
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

  private latestVibrationStatusByNode: Map<string, any> = new Map();

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
    @InjectRepository(Evidence)
    private readonly evidenceRepo: Repository<Evidence>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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

    // Backend TUYỆT ĐỐI không tự tạo AlarmEvent từ telemetry.
    // Tất cả AlarmEvent trong toàn bộ hệ thống đều do Jetson TX2 phân tích và phát qua MQTT (handleAnomalyEvent).
    return { snapshot, alarms: [] };
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

  /**
   * Xử lý trạng thái ngưỡng độ rung đã xử lý từ Jetson TX2, gửi cả khi breach=false
   * (NORMAL/WARNING) để dashboard vẽ biểu đồ ngưỡng realtime.
   * Topic: status/gateway/{gateway_id}/node/{node_id}/vibration
   */
  async handleVibrationStatus(
    gatewayId: string,
    nodeId: string,
    payload: {
      node_id?: string;
      severity?: string;
      value?: number;
      duration_sec?: number;
      breach?: boolean;
      timestamp?: string;
    },
  ): Promise<any> {
    const targetNodeId = payload.node_id || nodeId;
    const status = {
      gatewayId,
      nodeId: targetNodeId,
      severity: payload.severity || 'NORMAL',
      value: Number(payload.value ?? 0),
      durationSec: Number(payload.duration_sec ?? 0),
      breach: Boolean(payload.breach),
      timestamp: payload.timestamp || new Date().toISOString(),
    };
    this.latestVibrationStatusByNode.set(targetNodeId, status);
    return status;
  }

  getLatestVibrationStatus(nodeId: string): any {
    return this.latestVibrationStatusByNode.get(nodeId) || null;
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

  // Lấy lịch sử dữ liệu thực tế từ TimescaleDB/PostgreSQL (cho Frontend hiển thị biểu đồ dài hạn)
  async getLongTermHistory(params: {
    sensorType?: string;
    damId?: string;
    stationId?: number;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<SensorReading[]> {
    const limit = params.limit || 100;
    const qb = this.sensorReadingRepo.createQueryBuilder('r')
      .orderBy('r.time', 'ASC')
      .take(limit);

    if (params.sensorType && params.sensorType !== 'all') {
      const typeLower = params.sensorType.toLowerCase();
      if (typeLower === 'vibration' || typeLower === 'vib') {
        qb.andWhere("(r.sensorType LIKE 'vibration%' OR r.sensorType = 'vib')");
      } else if (typeLower === 'water_level' || typeLower === 'wtl') {
        qb.andWhere("(r.sensorType IN ('water_level', 'wtl', 'water'))");
      } else if (typeLower === 'moisture' || typeLower === 'mst') {
        qb.andWhere("(r.sensorType IN ('moisture', 'humidity', 'mst'))");
      } else {
        qb.andWhere('r.sensorType = :sensorType', { sensorType: params.sensorType });
      }
    }

    if (params.damId && params.damId !== 'all') {
      qb.andWhere('r.damId = :damId', { damId: params.damId });
    }

    if (params.startDate) {
      qb.andWhere('r.time >= :startDate', { startDate: new Date(params.startDate) });
    }

    if (params.endDate) {
      qb.andWhere('r.time <= :endDate', { endDate: new Date(params.endDate) });
    }

    return qb.getMany();
  }

  // Thống kê KPI thực tế từ cơ sở dữ liệu
  async getHistoryKpi(params: {
    damId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    totalAlarms: number;
    maxWaterLevel: number;
    avgResponseTimeSec: number;
    unresolvedCount: number;
  }> {
    const alarmQb = this.alarmEventRepo.createQueryBuilder('a');
    if (params.damId && params.damId !== 'all') {
      alarmQb.andWhere('a.damId = :damId', { damId: params.damId });
    }
    if (params.startDate) {
      alarmQb.andWhere('a.triggeredAt >= :startDate', { startDate: new Date(params.startDate) });
    }
    if (params.endDate) {
      alarmQb.andWhere('a.triggeredAt <= :endDate', { endDate: new Date(params.endDate) });
    }

    const alarms = await alarmQb.getMany();
    const totalAlarms = alarms.length;
    const unresolvedCount = alarms.filter(a => !a.resolvedAt).length;

    // Thời gian phản ứng trung bình của các sự kiện đã xử lý
    let totalRespTimeSec = 0;
    let resolvedCount = 0;
    for (const a of alarms) {
      if (a.resolvedAt && a.triggeredAt) {
        const diffSec = (new Date(a.resolvedAt).getTime() - new Date(a.triggeredAt).getTime()) / 1000;
        if (diffSec >= 0) {
          totalRespTimeSec += diffSec;
          resolvedCount++;
        }
      }
    }
    const avgResponseTimeSec = resolvedCount > 0 ? Math.round(totalRespTimeSec / resolvedCount) : 0;

    // Mực nước cao nhất ghi nhận được trong kỳ
    const readingQb = this.sensorReadingRepo.createQueryBuilder('r')
      .where("r.sensorType IN ('water_level', 'wtl')");

    if (params.damId && params.damId !== 'all') {
      readingQb.andWhere('r.damId = :damId', { damId: params.damId });
    }
    if (params.startDate) {
      readingQb.andWhere('r.time >= :startDate', { startDate: new Date(params.startDate) });
    }
    if (params.endDate) {
      readingQb.andWhere('r.time <= :endDate', { endDate: new Date(params.endDate) });
    }

    const maxReading = await readingQb.select('MAX(r.value)', 'maxVal').getRawOne();
    const maxWaterLevel = maxReading && maxReading.maxVal != null ? Number(maxReading.maxVal) : 0;

    return {
      totalAlarms,
      maxWaterLevel,
      avgResponseTimeSec,
      unresolvedCount,
    };
  }

  // Quản lý cấu hình ngưỡng
  async getThresholdConfigs(damId: string): Promise<ThresholdConfig[]> {
    return this.thresholdConfigRepo.find({ where: { damId } });
  }

  async updateThresholdConfig(id: string, update: Partial<ThresholdConfig>, actorUser?: User): Promise<ThresholdConfig> {
    const currentConfig = await this.thresholdConfigRepo.findOneOrFail({ where: { id } });

    if (update.warnHigh !== undefined && (isNaN(Number(update.warnHigh)) || Number(update.warnHigh) < 0 || Number(update.warnHigh) > 1000)) {
      throw new BadRequestException('Giá trị warnHigh không hợp lệ (phải là số từ 0 đến 1000).');
    }
    if (update.alertHigh !== undefined && (isNaN(Number(update.alertHigh)) || Number(update.alertHigh) < 0 || Number(update.alertHigh) > 1000)) {
      throw new BadRequestException('Giá trị alertHigh không hợp lệ (phải là số từ 0 đến 1000).');
    }
    if (update.criticalHigh !== undefined && (isNaN(Number(update.criticalHigh)) || Number(update.criticalHigh) < 0 || Number(update.criticalHigh) > 1000)) {
      throw new BadRequestException('Giá trị criticalHigh không hợp lệ (phải là số từ 0 đến 1000).');
    }

    const effectiveWarnHigh = update.warnHigh !== undefined ? Number(update.warnHigh) : currentConfig.warnHigh;
    const effectiveAlertHigh = update.alertHigh !== undefined ? Number(update.alertHigh) : currentConfig.alertHigh;
    const effectiveCriticalHigh = update.criticalHigh !== undefined ? Number(update.criticalHigh) : currentConfig.criticalHigh;

    if (!(effectiveWarnHigh < effectiveAlertHigh && effectiveAlertHigh < effectiveCriticalHigh)) {
      throw new BadRequestException(
        `Ngưỡng không hợp lệ: Yêu cầu warnHigh (${effectiveWarnHigh}) < alertHigh (${effectiveAlertHigh}) < criticalHigh (${effectiveCriticalHigh}).`,
      );
    }

    await this.thresholdConfigRepo.update(id, update);
    const updated = await this.thresholdConfigRepo.findOneOrFail({ where: { id } });

    // Đồng bộ ngưỡng độ rung của Đập/Trạm sang các Node Jetson TX2 thuộc Đập/Trạm này
    if (updated.sensorType === 'vibration') {
      try {
        const nodes = await this.nodeRepo.createQueryBuilder('node')
          .leftJoinAndSelect('node.gateway', 'gateway')
          .leftJoinAndSelect('gateway.station', 'station')
          .where('station.damId = :damId', { damId: updated.damId })
          .getMany();

        for (const node of nodes) {
          node.warnHigh = updated.warnHigh;
          node.vibrationThreshold = updated.alertHigh;
          node.criticalHigh = updated.criticalHigh;
          await this.nodeRepo.save(node);
        }
        console.log(`[SensorService] Backend đã đồng bộ ngưỡng độ rung (${updated.warnHigh} / ${updated.alertHigh} / ${updated.criticalHigh}) sang ${nodes.length} Sensor Node(s) Jetson TX2 thuộc Đập ${updated.damId}`);
      } catch (e: any) {
        console.warn('[SensorService] Lỗi đồng bộ ngưỡng độ rung xuống Node:', e.message);
      }
    }

    this.thresholdConfigCache.delete(updated.damId);
    const configs = await this.thresholdConfigRepo.find({ where: { damId: updated.damId } });
    this.thresholdConfigCache.set(updated.damId, configs);

    await this.auditLogService.logAction({
      action: 'UPDATE_THRESHOLD',
      category: 'THRESHOLD',
      description: `Thay đổi cấu hình ngưỡng báo động [${updated.sensorType.toUpperCase()}] đập ${updated.damId} (Warn: ${updated.warnHigh}, Alert: ${updated.alertHigh}, Critical: ${updated.criticalHigh})`,
      username: actorUser?.username || 'admin',
      userRole: actorUser?.role || 'ADMIN',
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

    const alarms = await qb.getMany();
    for (const a of alarms) {
      if (!a.measuredVal || Number(a.measuredVal) === 0) {
        a.measuredVal = a.thresholdVal && Number(a.thresholdVal) > 0 ? Number(a.thresholdVal) : 15.0;
      }
    }
    return alarms;
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
    const severity = isCrack
      ? 'CRITICAL'
      : (payload.severity || 'ALERT');

    // 1. Resolve target damId, stationId, names, and threshold from relations
    let targetDamId = DEFAULT_DAM_ID;
    let targetThreshold = 15.0;
    let targetStationId: number | undefined;
    let targetStationName = '';
    let targetDamName = '';
    let targetLocation = '';

    if (payload.node_id) {
      try {
        const node = await this.nodeRepo.findOne({
          where: { id: payload.node_id },
          relations: { gateway: { station: { dam: true } } },
        });
        if (node?.gateway?.station) {
          targetStationId = node.gateway.station.id;
          targetStationName = node.gateway.station.name;
          targetDamId = node.gateway.station.damId;
          targetDamName = node.gateway.station.dam?.name || `Đập ${targetDamId}`;
          targetLocation = node.gateway.station.location || node.gateway.station.km || 'Vị trí công trình đập';
        }
        if (node?.vibrationThreshold != null) {
          targetThreshold = Number(node.vibrationThreshold);
        }
      } catch (err: any) {
        console.warn('[SensorService] Lỗi tra cứu damId theo node:', err.message);
      }
    } else if (payload.gateway_id) {
      try {
        const gw = await this.gatewayRepo.findOne({
          where: { id: payload.gateway_id },
          relations: { station: { dam: true } },
        });
        if (gw?.station) {
          targetStationId = gw.station.id;
          targetStationName = gw.station.name;
          targetDamId = gw.station.damId;
          targetDamName = gw.station.dam?.name || `Đập ${targetDamId}`;
          targetLocation = gw.station.location || gw.station.km || 'Vị trí công trình đập';
        }
      } catch (err: any) {
        console.warn('[SensorService] Lỗi tra cứu damId theo gateway:', err.message);
      }
    }

    // Resolve measuredVal with fallback to realtime node cache or threshold
    let measuredVal = Number(
      payload.measured_val ??
      payload.measuredVal ??
      (payload as any).value ??
      (payload as any).amp ??
      (payload as any).ppv ??
      (payload as any).measuredValue ??
      0,
    );

    if (isNaN(measuredVal) || measuredVal <= 0) {
      const cached = this.nodeStateCache.get(payload.node_id) || this.latestByNode.get(payload.node_id);
      if (cached && cached.amp > 0) {
        measuredVal = cached.amp;
      }
    }
    if (isNaN(measuredVal) || measuredVal <= 0) {
      if (payload.crack_size && payload.crack_size > 0) {
        measuredVal = Number(payload.crack_size);
      } else {
        measuredVal = targetThreshold > 0 ? targetThreshold : 15.0;
      }
    }

    console.log(
      `[SensorService] Nhận sự kiện Anomaly từ Gateway ${payload.gateway_id} / Node ${payload.node_id} (eventId: ${eventId || 'N/A'}, MeasuredVal: ${measuredVal} mm/s, Severity: ${severity}, Crack: ${isCrack})`,
    );

    // Kiểm tra xem ảnh evidence đã upload trước đó chưa
    let uploadedImageUrl: string | undefined;
    if (eventId) {
      try {
        const evidence = await this.evidenceRepo.findOne({ where: { eventId } });
        if (evidence) {
          uploadedImageUrl = evidence.imageUrl;
        }
      } catch {
        // ignore
      }
    }

    // 2. Tìm AlarmEvent theo eventId duy nhất của sự cố (chỉ cập nhật nếu đã tồn tại đúng eventId này)
    let event: AlarmEvent | null = null;
    if (eventId) {
      event = await this.alarmEventRepo.findOne({ where: { eventId } });
    }

    if (event) {
      // Ghép dữ liệu AI từ MQTT vào AlarmEvent hiện có
      if (eventId && !event.eventId) event.eventId = eventId;
      event.crackDetected = isCrack;
      event.crackConfidence = payload.confidence;
      if (measuredVal > 0) {
        event.measuredVal = measuredVal;
      } else if (!event.measuredVal || Number(event.measuredVal) === 0) {
        event.measuredVal = targetThreshold;
      }
      if (uploadedImageUrl && !event.imageUrl) {
        event.imageUrl = uploadedImageUrl;
      }
      if (payload.duration_sec != null) event.durationS = Number(payload.duration_sec);
      if (payload.crack_size != null) event.crackSize = Number(payload.crack_size);
      if (targetStationId && !event.stationId) event.stationId = targetStationId;
      if (targetStationName && !event.stationName) event.stationName = targetStationName;
      if (targetDamName && !event.damName) event.damName = targetDamName;
      if (targetLocation && !event.location) event.location = targetLocation;
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
      if (payload.duration_sec != null) event.durationS = Number(payload.duration_sec);
      if (payload.crack_size != null) event.crackSize = Number(payload.crack_size);
      if (uploadedImageUrl) event.imageUrl = uploadedImageUrl;
      if (targetStationId) event.stationId = targetStationId;
      if (targetStationName) event.stationName = targetStationName;
      if (targetDamName) event.damName = targetDamName;
      if (targetLocation) event.location = targetLocation;
      event.notes = isCrack
        ? `Phát hiện vết nứt bằng YOLO AI trên Jetson TX2 (${payload.gateway_id}). Confidence: ${(payload.confidence * 100).toFixed(1)}%`
        : `Camera AI trên Jetson TX2 (${payload.gateway_id}) đã kiểm tra - Không phát hiện vết nứt. Confidence: ${(payload.confidence * 100).toFixed(1)}%`;
    }

    await this.alarmEventRepo.save(event);
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

  /**
   * Truy vấn danh sách Cán bộ phụ trách quản lý của một Đập thủy điện
   */
  async getDamManagers(damId?: string): Promise<{ id: string; username: string; email: string; fullName: string; role: string; assignedDamId: string }[]> {
    const selectFields = { id: true, username: true, email: true, fullName: true, role: true, assignedDamId: true } as const;
    if (!damId || damId === 'all') {
      return this.userRepo.find({
        where: { status: 'ACTIVE' },
        select: selectFields,
      });
    }

    const assignedUsers = await this.userRepo.find({
      where: { assignedDamId: damId, status: 'ACTIVE' },
      select: selectFields,
    });

    if (assignedUsers.length > 0) {
      return assignedUsers;
    }

    // Fallback nếu đập chưa được gán cán bộ riêng: Lấy danh sách ADMIN active
    return this.userRepo.find({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: selectFields,
    });
  }

  async sendEmailAlert(payload: {
    toEmail?: string | string[];
    subject?: string;
    message: string;
    alarmId?: string;
    damId?: string;
  }): Promise<{ success: boolean; message: string }> {
    const host = this.configService.get<string>('SMTP_HOST', 'smtp.gmail.com');
    const port = this.configService.get<number>('SMTP_PORT', 587);
    const user = this.configService.get<string>('SMTP_USER', '');
    const pass = this.configService.get<string>('SMTP_PASS', '');

    // 1. Tìm thông tin sự kiện cảnh báo từ DB nếu có alarmId
    let alarmInfo: AlarmEvent | null = null;
    if (payload.alarmId) {
      try {
        alarmInfo = await this.alarmEventRepo.findOne({ where: { id: payload.alarmId } });
      } catch (e) {
        console.warn('[SensorService] Không thể tải thông tin alarmId:', payload.alarmId);
      }
    }

    const effectiveDamId = payload.damId || alarmInfo?.damId || DEFAULT_DAM_ID;

    // 2. Tự động lấy danh sách Email Cán bộ quản lý đập xảy ra sự cố từ CSDL
    const damManagers = await this.getDamManagers(effectiveDamId);
    const managerEmails = damManagers.map(m => m.email).filter(Boolean);

    let emailArray: string[] = [];
    if (payload.toEmail) {
      if (Array.isArray(payload.toEmail)) {
        emailArray = payload.toEmail.filter(e => Boolean(e && e.trim()));
      } else if (typeof payload.toEmail === 'string') {
        emailArray = payload.toEmail.split(',').map(e => e.trim()).filter(Boolean);
      }
    }

    // Hợp nhất Email Cán bộ phụ trách đập và các email được truyền vào
    const combinedEmails = Array.from(new Set([...emailArray, ...managerEmails]));
    const targetEmail = combinedEmails.length > 0
      ? combinedEmails.join(', ')
      : this.configService.get<string>('DEFAULT_ALERT_EMAIL', 'ruka13312002@gmail.com');

    const emailSubject = payload.subject || `[CẢNH BÁO AN TOÀN HỒ ĐẬP] Sự cố tại Đập ${effectiveDamId}`;

    const locationText = alarmInfo
      ? `Trạm ${alarmInfo.sensorId === 'sensor_node_1' ? 'K25+500 (Thân đập chính)' : alarmInfo.sensorId} - Đập ${alarmInfo.damId}`
      : `Đập ${effectiveDamId}`;

    console.log(`[SensorService] Gửi Email cảnh báo tới Cán bộ quản lý đập (${effectiveDamId}): ${targetEmail}`);

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
          <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Gửi đến Cán bộ phụ trách quản lý Đập ${effectiveDamId}</p>
        </div>
        <div style="padding: 24px;">
          <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 14px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #991b1b; font-weight: bold; font-size: 14px;">Thông điệp chỉ đạo khẩn cấp từ Ban Quản Lý:</p>
            <p style="margin: 8px 0 0 0; color: #7f1d1d; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${payload.message}</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px;">
            <tr style="border-bottom: 1px solid #f0f0f0;">
              <td style="padding: 10px; font-weight: bold; color: #555; width: 40%;">📍 Vị trí sự cố:</td>
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
            <a href="http://localhost:3000/alerts" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; font-size: 13px; border-radius: 6px; display: inline-block;">TRUY CẬP TRUNG TÂM CHỈ HUY KHẨN CẤP</a>
          </div>
        </div>
        <div style="background-color: #f9fafb; padding: 14px; text-align: center; font-size: 11px; color: #6b7280; border-top: 1px solid #f0f0f0;">
          Email tự động gửi tới Cán bộ Quản lý Đập ${effectiveDamId}.
        </div>
      </div>
    `;

    try {
      if (!user || pass === 'app_password_here') {
        console.warn('[SensorService] SMTP chưa được cấu hình mật khẩu thực tế trong .env. Đã ghi nhận lệnh gửi email giả lập thành công.');
        return {
          success: true,
          message: `Đã giả lập gửi Email thành công tới Cán bộ trực đập (${targetEmail}).`,
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
        message: `Đã gửi Email cảnh báo tới Cán bộ trực đập (${targetEmail})!`,
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


