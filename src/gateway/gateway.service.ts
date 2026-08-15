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
import { Camera } from '../camera/entities/camera.entity';
import * as mqtt from 'mqtt';

@Injectable()
export class GatewayService implements OnModuleInit {
  private mqttClient?: mqtt.MqttClient;

  constructor(
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
    @InjectRepository(Camera)
    private readonly cameraRepo: Repository<Camera>,
    private readonly configService: ConfigService,
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

  async findAll(stationId?: number): Promise<Gateway[]> {
    const where: any = {};
    if (stationId) where.stationId = stationId;
    return this.gatewayRepo.find({
      where,
      relations: { nodes: true, cameras: true, station: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findById(id: string): Promise<Gateway> {
    const gw = await this.gatewayRepo.findOne({
      where: { id },
      relations: { nodes: true, cameras: true, station: true },
    });
    if (!gw) throw new NotFoundException(`Gateway "${id}" không tồn tại.`);
    return gw;
  }

  async create(dto: CreateGatewayDto): Promise<Gateway> {
    validateDeviceId('GATEWAY', dto.id);

    const existing = await this.gatewayRepo.findOne({ where: { id: dto.id } });
    if (existing) {
      throw new ConflictException(
        `Gateway "${dto.id}" đã tồn tại trên hệ thống.`,
      );
    }

    const gateway = this.gatewayRepo.create(dto);
    const saved = await this.gatewayRepo.save(gateway);
    this.publishGatewayConfig(saved.id).catch(() => {});
    return saved;
  }

  async update(id: string, dto: UpdateGatewayDto): Promise<Gateway> {
    await this.findById(id);
    await this.gatewayRepo.update(id, dto);
    const updated = await this.findById(id);
    this.publishGatewayConfig(id).catch(() => {});
    return updated;
  }

  async delete(id: string): Promise<{ ok: boolean }> {
    const gw = await this.findById(id);
    await this.gatewayRepo.remove(gw);
    return { ok: true };
  }

  /**
   * Config Sync for Jetson TX2 — GET /api/gateway/:id/config
   */
  async getGatewayConfig(gatewayId: string): Promise<any> {
    const gw = await this.gatewayRepo.findOne({
      where: { id: gatewayId },
      relations: { nodes: true, cameras: true },
    });

    if (!gw) {
      throw new NotFoundException(`Gateway "${gatewayId}" không tồn tại.`);
    }

    // Build nodes map per Edge Gateway contract:
    // { node_id: { camera_id, warn_high, alert_high, critical_high, alert_min_count, alert_min_duration_sec, episode_reset_gap_sec } }
    const nodesMap: Record<string, any> = {};
    if (gw.nodes) {
      for (const node of gw.nodes) {
        nodesMap[node.id] = {
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
        camerasMap[cam.id] = camObj;
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
      await this.publishGatewayConfig(gw.id);
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
            `[HeartbeatCron] Gateway "${gw.id}" không gửi tín hiệu trong 30s (lần cuối: ${gw.lastSeenAt ? new Date(gw.lastSeenAt).toISOString() : 'chưa gửi'}). Đã chuyển sang OFFLINE.`,
          );
        }
      }
    } catch (err: any) {
      console.warn('[HeartbeatCron] Lỗi khi kiểm tra heartbeat Gateway:', err.message);
    }
  }
}
