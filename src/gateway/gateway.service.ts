import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Gateway } from './entities/gateway.entity';
import { CreateGatewayDto, UpdateGatewayDto } from './gateway.dto';
import { validateDeviceId } from '../common/validators/naming-convention.validator';
import { Station } from '../dam/entities/station.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import * as mqtt from 'mqtt';

// `station: { dam: true }` cần thiết để @AfterLoad điền được gateway.stationId và station.damId.
// `nodes: { mappedCamera: true }` phải khai báo tường minh: TypeORM chỉ tự áp dụng quan hệ eager
// ở cấp gốc, không áp dụng cho entity nằm trong nhánh quan hệ lồng nhau.
const GATEWAY_RELATIONS = {
  nodes: { mappedCamera: true, sensors: true },
  cameras: true,
  station: { dam: true },
} as const;

@Injectable()
export class GatewayService implements OnModuleInit {
  private mqttClient?: mqtt.MqttClient;

  constructor(
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
    @InjectRepository(Station)
    private readonly stationRepo: Repository<Station>,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  onModuleInit() {
    const brokerUrl =
      this.configService.get<string>('MQTT_BROKER_URL') ||
      'mqtt://localhost:1883';
    try {
      this.mqttClient = mqtt.connect(brokerUrl, {
        clientId: `backend_gateway_service_${Math.random().toString(16).substring(2, 8)}`,
      });
      this.mqttClient.on('connect', () => {
        console.log('[GatewayService] Connected to MQTT broker for config publishing.');
      });
      this.mqttClient.on('error', (err) => {
        console.warn('[GatewayService] MQTT connection error:', err.message);
      });
    } catch (err: any) {
      console.warn('[GatewayService] Failed to initialize MQTT client:', err.message);
    }
  }

  /** Đổi mã trạm (STA-001-01) sang bản ghi Station (cần .id cho Gateway.stationRefId). */
  private async resolveStation(stationId: string): Promise<Station> {
    const station = await this.stationRepo.findOne({ where: { stationId } });
    if (!station) {
      throw new NotFoundException(`Trạm "${stationId}" không tồn tại.`);
    }
    return station;
  }

  /**
   * Sinh mã gateway GTW-[STATION_CODE]-[SEQ_ID] theo chuẩn A.3.2.
   * Gateway đầu của trạm là TX2A; trạm gắn thêm gateway thì tăng chữ cái (TX2B, TX2C...).
   * Public để NodeService dùng lại — quy tắc đặt tên chỉ có một nguồn duy nhất.
   */
  async nextGatewayId(station: Station): Promise<string> {
    const stationCode = station.stationCode || `ST${String(station.id).padStart(2, '0')}`;
    for (let i = 0; i < 26; i++) {
      const candidate = `GTW-${stationCode}-TX2${String.fromCharCode(65 + i)}`;
      const taken = await this.gatewayRepo.findOne({ where: { gatewayId: candidate } });
      if (!taken) return candidate;
    }
    throw new ConflictException(
      `Trạm "${station.stationId}" đã dùng hết dải mã gateway TX2A–TX2Z.`,
    );
  }

  async findAll(stationId?: string, damId?: string): Promise<Gateway[]> {
    const where: any = {};
    if (stationId) where.station = { stationId };
    if (damId && damId !== 'all') {
      where.station = { ...(where.station || {}), dam: { damId } };
    }

    return this.gatewayRepo.find({
      where,
      relations: GATEWAY_RELATIONS,
      order: { createdAt: 'ASC' },
    });
  }

  async findById(gatewayId: string): Promise<Gateway> {
    const gw = await this.gatewayRepo.findOne({
      where: { gatewayId },
      relations: GATEWAY_RELATIONS,
    });
    if (!gw) throw new NotFoundException(`Gateway "${gatewayId}" không tồn tại.`);
    return gw;
  }

  async create(dto: CreateGatewayDto): Promise<Gateway> {
    const { stationId, gatewayId: requestedId, ...rest } = dto;
    const station = await this.resolveStation(stationId);

    const gatewayId = requestedId?.trim() || (await this.nextGatewayId(station));
    validateDeviceId('GATEWAY', gatewayId);

    const existing = await this.gatewayRepo.findOne({ where: { gatewayId } });
    if (existing) {
      throw new ConflictException(
        `Gateway "${gatewayId}" đã tồn tại trên hệ thống.`,
      );
    }

    const gateway = this.gatewayRepo.create({
      ...rest,
      gatewayId,
      stationRefId: station.id,
      status: 'offline', // Mặc định luôn là offline khi mới tạo; chuyển online tự động khi có heartbeat/telemetry
    });
    await this.gatewayRepo.save(gateway);
    const saved = await this.findById(gatewayId);
    this.publishGatewayConfig(saved.gatewayId).catch(() => {});
    return saved;
  }

  /**
   * Cập nhật Gateway. Đập/Trạm là hạ tầng cố định nên mã của chúng không bao giờ đổi, nhưng
   * Gateway là phần cứng thường bị tháo lắp lại — khi trạm gắn kèm thực sự đổi, mã Gateway được
   * SINH LẠI theo trạm mới (GTW-[STATION_CODE_MỚI]-TX2x) để không còn "nói dối" vị trí, đúng như
   * bảng quy tắc A.3.2 mô tả. Khoá chính kỹ thuật (`id`) không đổi — đây là đổi tên tại chỗ, không
   * phải xoá-tạo-lại.
   *
   * QUAN TRỌNG: thiết bị Jetson TX2 vật lý tự lưu mã của chính nó để subscribe MQTT
   * (`config/gateway/{id}/update`, `telemetry/gateway/{id}/node/...`) và gọi `GET /api/gateway/{id}/config`.
   * Đổi mã ở backend KHÔNG tự động cập nhật xuống thiết bị — phải cấu hình lại thiết bị thủ công
   * sau khi đổi trạm, nếu không nó sẽ mất kết nối với backend.
   */
  async update(
    gatewayId: string,
    dto: UpdateGatewayDto,
  ): Promise<{ gateway: Gateway; renamedFrom?: string }> {
    const existing = await this.findById(gatewayId);

    const { stationId, ...rest } = dto;
    const updateData: Partial<Gateway> = { ...rest };
    let targetGatewayId = gatewayId;
    let renamedFrom: string | undefined;

    if (stationId !== undefined && stationId !== existing.stationId) {
      const newStation = await this.resolveStation(stationId);
      updateData.stationRefId = newStation.id;
      updateData.gatewayId = await this.nextGatewayId(newStation);
      targetGatewayId = updateData.gatewayId;
      renamedFrom = gatewayId;
    }

    await this.gatewayRepo.update({ gatewayId }, updateData);
    const updated = await this.findById(targetGatewayId);

    this.publishGatewayConfig(updated.gatewayId).catch(() => {});
    if (renamedFrom) {
      // Dọn retained message ở topic cũ — nếu không, broker vẫn giữ config cũ mãi mãi trên
      // topic mà giờ không còn thiết bị/gateway nào hợp lệ theo dõi.
      this.clearRetainedConfig(renamedFrom).catch(() => {});
      await this.auditLogService.logAction({
        action: 'RENAME_GATEWAY',
        category: 'GATEWAY',
        description: `Gateway đổi trạm nên đổi mã: "${renamedFrom}" → "${updated.gatewayId}" (trạm mới: ${updated.stationId}). Cần cấu hình lại thiết bị Jetson TX2 vật lý.`,
        username: 'admin',
        userRole: 'ADMIN',
        metadata: { oldGatewayId: renamedFrom, newGatewayId: updated.gatewayId, stationId: updated.stationId },
      });
    }

    return { gateway: updated, renamedFrom };
  }

  async delete(gatewayId: string): Promise<{ ok: boolean }> {
    const gw = await this.findById(gatewayId);
    await this.gatewayRepo.remove(gw);
    return { ok: true };
  }

  /**
   * Config Sync for Jetson TX2 — GET /api/gateway/:id/config
   */
  async getGatewayConfig(gatewayId: string): Promise<any> {
    // `nodes: { mappedCamera: true }` bắt buộc — camera_id trong config Jetson lấy từ
    // node.mappedCameraId, vốn chỉ được @AfterLoad điền khi quan hệ mappedCamera đã load.
    const gw = await this.gatewayRepo.findOne({
      where: { gatewayId },
      relations: { nodes: { mappedCamera: true }, cameras: true },
    });

    if (!gw) {
      throw new NotFoundException(`Gateway "${gatewayId}" không tồn tại.`);
    }

    // Build nodes map per Edge Gateway contract:
    // { node_id: { camera_id, warn_high, alert_high, critical_high, alert_min_count, alert_min_duration_sec, episode_reset_gap_sec } }
    const nodesMap: Record<string, any> = {};
    if (gw.nodes) {
      for (const node of gw.nodes) {
        nodesMap[node.nodeId] = {
          camera_id: node.mappedCameraId || null,
          warn_high: node.warnHigh ?? 2.5,
          alert_high: node.vibrationThreshold ?? 15.0,
          critical_high: node.criticalHigh ?? 25.0,
          alert_min_count: node.alertMinCount ?? 4,
          alert_min_duration_sec: node.alertMinDurationSec ?? 6.0,
          episode_reset_gap_sec: node.episodeResetGapSec ?? 3.0,
        };
      }
    }

    // Build cameras map: { camera_id: { camera_type, stream_url? } }
    // stream_url chỉ xuất hiện khi có giá trị thực (bắt buộc với IP, không cần với CSI).
    const camerasMap: Record<string, any> = {};
    if (gw.cameras) {
      for (const cam of gw.cameras) {
        const camObj: any = { camera_type: cam.cameraType };
        if (cam.streamUrl) camObj.stream_url = cam.streamUrl;
        camerasMap[cam.cameraId] = camObj;
      }
    }

    return { nodes: nodesMap, cameras: camerasMap };
  }

  /**
   * Publish updated gateway config over MQTT for real-time edge synchronization
   * Topic: config/gateway/{gatewayId}/update
   */
  async publishGatewayConfig(gatewayId: string): Promise<void> {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    try {
      const config = await this.getGatewayConfig(gatewayId);
      const topic = `config/gateway/${gatewayId}/update`;
      const payload = JSON.stringify(config);
      this.mqttClient.publish(topic, payload, { qos: 1, retain: true }, (err) => {
        if (err) {
          console.warn(`[GatewayService] Failed to publish config to ${topic}:`, err.message);
        } else {
          console.log(`[GatewayService] Published realtime config to MQTT topic: ${topic}`);
        }
      });
    } catch (err: any) {
      console.warn(`[GatewayService] Error preparing config broadcast for ${gatewayId}:`, err.message);
    }
  }

  /**
   * Xoá retained message config ở mã Gateway cũ sau khi đổi mã (publish payload rỗng cùng
   * retain:true theo đúng cơ chế MQTT để xoá retained message trên broker).
   */
  private async clearRetainedConfig(oldGatewayId: string): Promise<void> {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    const topic = `config/gateway/${oldGatewayId}/update`;
    this.mqttClient.publish(topic, '', { qos: 1, retain: true }, (err) => {
      if (err) {
        console.warn(`[GatewayService] Không xoá được retained config cũ tại ${topic}:`, err.message);
      } else {
        console.log(`[GatewayService] Đã xoá retained config cũ tại topic: ${topic}`);
      }
    });
  }

  /**
   * Optional auth for the Jetson-facing config endpoint.
   * Only enforced when GATEWAY_API_KEY is set in the environment — keeps
   * backward compatibility with gateways that don't send any auth header.
   */
  validateGatewayApiKey(apiKey?: string): void {
    const expected = this.configService.get<string>('GATEWAY_API_KEY');
    if (!expected) return;
    if (!apiKey || apiKey !== expected) {
      throw new UnauthorizedException('API key của gateway không hợp lệ hoặc bị thiếu.');
    }
  }

  async broadcastAllGatewayConfigs(): Promise<void> {
    const gateways = await this.gatewayRepo.find();
    for (const gw of gateways) {
      await this.publishGatewayConfig(gw.gatewayId);
    }
  }

  // ── Gateway Heartbeat Cronjob ──
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleGatewayHeartbeatCheck(): Promise<void> {
    const TIMEOUT_MS = 30 * 1000;
    const now = Date.now();
    try {
      const onlineGateways = await this.gatewayRepo.find({ where: { status: 'online' } });
      for (const gw of onlineGateways) {
        const lastSeen = gw.lastSeenAt ? new Date(gw.lastSeenAt).getTime() : 0;
        if (now - lastSeen > TIMEOUT_MS) {
          await this.gatewayRepo.update(gw.id, { status: 'offline' });
          console.log(
            `[HeartbeatCron] Gateway "${gw.gatewayId}" không gửi tín hiệu trong 30s (lần cuối: ${gw.lastSeenAt ? new Date(gw.lastSeenAt).toISOString() : 'chưa gửi'}). Đã chuyển sang OFFLINE.`,
          );
        }
      }
    } catch (err: any) {
      console.warn('[HeartbeatCron] Lỗi khi kiểm tra heartbeat Gateway:', err.message);
    }
  }
}
