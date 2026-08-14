import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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

    // Build nodes map: { node_id: { camera_id, threshold, warn_high, alert_high, critical_high } }
    const nodesMap: Record<string, any> = {};
    if (gw.nodes) {
      for (const node of gw.nodes) {
        const threshold = node.vibrationThreshold ?? 15.0;
        nodesMap[node.id] = {
          camera_id: node.mappedCameraId || null,
          threshold: threshold,
          warn_high: 2.5,
          alert_high: threshold,
          critical_high: 25.0,
        };
      }
    }

    // Build cameras map: { camera_id: { camera_type, stream_url } }
    const camerasMap: Record<string, any> = {};
    if (gw.cameras) {
      for (const cam of gw.cameras) {
        camerasMap[cam.id] = {
          camera_type: cam.cameraType,
          stream_url: cam.streamUrl || null,
        };
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

  async broadcastAllGatewayConfigs(): Promise<void> {
    const gateways = await this.gatewayRepo.find();
    for (const gw of gateways) {
      await this.publishGatewayConfig(gw.id);
    }
  }
}
