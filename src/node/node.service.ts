import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Node } from './entities/node.entity';
import { Sensor } from './entities/sensor.entity';
import {
  CreateNodeDto,
  UpdateNodeDto,
  CreateSensorDto,
  UpdateSensorDto,
} from './node.dto';
import {
  validateDeviceId,
  validateSensorType,
} from '../common/validators/naming-convention.validator';
import { GatewayService } from '../gateway/gateway.service';
import { SensorService } from '../sensor/sensor.service';
import { CameraService } from '../camera/camera.service';

@Injectable()
export class NodeService {
  constructor(
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Sensor)
    private readonly sensorRepo: Repository<Sensor>,
    private readonly gatewayService: GatewayService,
    private readonly sensorService: SensorService,
    private readonly cameraService: CameraService,
  ) {}

  /**
   * Validate vibration threshold ordering per Edge Gateway config contract:
   * warn_high < alert_high < critical_high; alert_min_count >= 1; *_sec >= 0.
   */
  private validateThresholds(
    warnHigh: number,
    alertHigh: number,
    criticalHigh: number,
    alertMinCount: number,
    alertMinDurationSec: number,
    episodeResetGapSec: number,
  ): void {
    if (!(warnHigh < alertHigh && alertHigh < criticalHigh)) {
      throw new BadRequestException(
        `Ngưỡng không hợp lệ: yêu cầu warn_high (${warnHigh}) < alert_high (${alertHigh}) < critical_high (${criticalHigh}).`,
      );
    }
    if (!(alertMinCount >= 1)) {
      throw new BadRequestException('alert_min_count phải >= 1.');
    }
    if (!(alertMinDurationSec >= 0) || !(episodeResetGapSec >= 0)) {
      throw new BadRequestException(
        'alert_min_duration_sec và episode_reset_gap_sec phải >= 0.',
      );
    }
  }

  private async assertCameraExists(cameraId: string): Promise<void> {
    try {
      await this.cameraService.findById(cameraId);
    } catch {
      throw new BadRequestException(
        `Camera "${cameraId}" không tồn tại, không thể gán cho node.`,
      );
    }
  }

  // ── Node CRUD ──

  async findAll(gatewayId?: string, stationId?: number, damId?: string): Promise<Node[]> {
    const qb = this.nodeRepo.createQueryBuilder('node')
      .leftJoinAndSelect('node.sensors', 'sensors')
      .leftJoinAndSelect('node.mappedCamera', 'mappedCamera')
      .leftJoinAndSelect('node.gateway', 'gateway')
      .leftJoinAndSelect('gateway.station', 'station')
      .leftJoinAndSelect('station.dam', 'dam')
      .orderBy('node.createdAt', 'ASC');

    if (gatewayId) {
      qb.andWhere('node.gatewayId = :gatewayId', { gatewayId });
    }
    if (stationId) {
      qb.andWhere('gateway.stationId = :stationId', { stationId });
    }
    if (damId && damId !== 'all') {
      qb.andWhere('station.damId = :damId', { damId });
    }

    return qb.getMany();
  }

  async findById(id: string): Promise<Node> {
    const node = await this.nodeRepo.findOne({
      where: { id },
      relations: { sensors: true, mappedCamera: true, gateway: { station: true } },
    });
    if (!node) throw new NotFoundException(`Node "${id}" không tồn tại.`);
    return node;
  }

  async create(dto: CreateNodeDto): Promise<Node> {
    let nodeId = dto.id ? dto.id.trim() : '';
    if (!nodeId) {
      const count = (await this.nodeRepo.count()) + 1;
      nodeId = `NOD-ST01-ESP${String(count).padStart(2, '0')}`;
    }

    validateDeviceId('NODE', nodeId);

    const existing = await this.nodeRepo.findOne({ where: { id: nodeId } });
    if (existing) {
      throw new ConflictException(
        `Node "${nodeId}" đã tồn tại trên hệ thống.`,
      );
    }

    let gatewayId = dto.gatewayId;
    if (!gatewayId && dto.stationId != null) {
      const stationIdNum = Number(dto.stationId);
      if (!isNaN(stationIdNum) && stationIdNum > 0) {
        try {
          const gwList = await this.gatewayService.findAll(stationIdNum);
          if (gwList && gwList.length > 0) {
            gatewayId = gwList[0].id;
          } else {
            const stationCode = `ST${String(stationIdNum).padStart(2, '0')}`;
            const newGwId = `GTW-${stationCode}-TX2A`;
            const mac = `00:04:4B:${String(stationIdNum).padStart(2, '0')}:00:01`;
            try {
              const createdGw = await this.gatewayService.create({
                id: newGwId,
                name: `Gateway Jetson TX2 - Trạm ${stationIdNum}`,
                macAddress: mac,
                firmwareVersion: 'L4T-r32.7.3',
                description: `Gateway tự động khởi tạo cho Trạm ${stationIdNum}`,
                stationId: stationIdNum,
              });
              gatewayId = createdGw.id;
            } catch {
              const existingGw = await this.gatewayService.findById(newGwId).catch(() => null);
              if (existingGw) gatewayId = existingGw.id;
            }
          }
        } catch {
          // ignore
        }
      }
    }
    if (!gatewayId) {
      gatewayId = 'GTW-ST01-TX2A';
    }

    const node = new Node();
    node.id = nodeId;
    node.name = dto.name;
    node.macAddress = dto.macAddress || dto.espMacAddress || 'AA:BB:CC:DD:EE:00';
    if (dto.description) node.description = dto.description;
    node.firmwareVersion = dto.firmwareVersion || 'v1.0.0';
    if (dto.installLocation) node.installLocation = dto.installLocation;
    node.vibrationThreshold = dto.vibrationThreshold != null ? Number(dto.vibrationThreshold) : 15.0;
    node.warnHigh = dto.warnHigh != null ? Number(dto.warnHigh) : 2.5;
    node.criticalHigh = dto.criticalHigh != null ? Number(dto.criticalHigh) : 25.0;
    node.alertMinCount = dto.alertMinCount != null ? Number(dto.alertMinCount) : 4;
    node.alertMinDurationSec = dto.alertMinDurationSec != null ? Number(dto.alertMinDurationSec) : 6.0;
    node.episodeResetGapSec = dto.episodeResetGapSec != null ? Number(dto.episodeResetGapSec) : 3.0;

    this.validateThresholds(
      node.warnHigh,
      node.vibrationThreshold,
      node.criticalHigh,
      node.alertMinCount,
      node.alertMinDurationSec,
      node.episodeResetGapSec,
    );

    node.gatewayId = gatewayId;
    if (dto.mappedCameraId) {
      await this.assertCameraExists(dto.mappedCameraId);
      node.mappedCameraId = dto.mappedCameraId;
    }

    const saved = await this.nodeRepo.save(node);
    const createdNode = await this.findById(saved.id);
    if (createdNode.gatewayId) {
      this.gatewayService.publishGatewayConfig(createdNode.gatewayId).catch(() => {});
    }
    if (createdNode.gateway?.stationId) {
      this.sensorService.updateNodeStationMapping(
        createdNode.id,
        createdNode.gateway.stationId,
        createdNode.gateway.station?.damId,
      );
    }
    return createdNode;
  }

  async update(id: string, dto: UpdateNodeDto): Promise<Node> {
    const existing = await this.findById(id);

    const updateData: Partial<Node> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.macAddress !== undefined) updateData.macAddress = dto.macAddress;
    else if (dto.espMacAddress !== undefined) updateData.macAddress = dto.espMacAddress;

    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.firmwareVersion !== undefined) updateData.firmwareVersion = dto.firmwareVersion;
    if (dto.installLocation !== undefined) updateData.installLocation = dto.installLocation;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.gatewayId !== undefined) updateData.gatewayId = dto.gatewayId;

    // Merge incoming threshold fields with current values to validate the
    // *effective* ordering (warn_high < alert_high < critical_high), since a
    // partial update may only touch one of the three fields.
    const effectiveWarnHigh = dto.warnHigh != null ? Number(dto.warnHigh) : existing.warnHigh;
    const effectiveAlertHigh = dto.vibrationThreshold != null ? Number(dto.vibrationThreshold) : existing.vibrationThreshold;
    const effectiveCriticalHigh = dto.criticalHigh != null ? Number(dto.criticalHigh) : existing.criticalHigh;
    const effectiveAlertMinCount = dto.alertMinCount != null ? Number(dto.alertMinCount) : existing.alertMinCount;
    const effectiveAlertMinDurationSec = dto.alertMinDurationSec != null ? Number(dto.alertMinDurationSec) : existing.alertMinDurationSec;
    const effectiveEpisodeResetGapSec = dto.episodeResetGapSec != null ? Number(dto.episodeResetGapSec) : existing.episodeResetGapSec;

    const thresholdFieldsChanged =
      dto.warnHigh !== undefined ||
      dto.vibrationThreshold !== undefined ||
      dto.criticalHigh !== undefined ||
      dto.alertMinCount !== undefined ||
      dto.alertMinDurationSec !== undefined ||
      dto.episodeResetGapSec !== undefined;

    if (thresholdFieldsChanged) {
      this.validateThresholds(
        effectiveWarnHigh,
        effectiveAlertHigh,
        effectiveCriticalHigh,
        effectiveAlertMinCount,
        effectiveAlertMinDurationSec,
        effectiveEpisodeResetGapSec,
      );
    }

    if (dto.vibrationThreshold !== undefined) updateData.vibrationThreshold = effectiveAlertHigh;
    if (dto.warnHigh !== undefined) updateData.warnHigh = effectiveWarnHigh;
    if (dto.criticalHigh !== undefined) updateData.criticalHigh = effectiveCriticalHigh;
    if (dto.alertMinCount !== undefined) updateData.alertMinCount = effectiveAlertMinCount;
    if (dto.alertMinDurationSec !== undefined) updateData.alertMinDurationSec = effectiveAlertMinDurationSec;
    if (dto.episodeResetGapSec !== undefined) updateData.episodeResetGapSec = effectiveEpisodeResetGapSec;

    if (dto.mappedCameraId !== undefined) {
      if (dto.mappedCameraId) await this.assertCameraExists(dto.mappedCameraId);
      updateData.mappedCameraId = dto.mappedCameraId;
    }

    // Resolve stationId change to corresponding Gateway
    if (dto.stationId != null) {
      const stationIdNum = Number(dto.stationId);
      if (!isNaN(stationIdNum) && stationIdNum > 0) {
        try {
          const gwList = await this.gatewayService.findAll(stationIdNum);
          if (gwList && gwList.length > 0) {
            updateData.gatewayId = gwList[0].id;
          } else {
            const stationCode = `ST${String(stationIdNum).padStart(2, '0')}`;
            const newGwId = `GTW-${stationCode}-TX2A`;
            const mac = `00:04:4B:${String(stationIdNum).padStart(2, '0')}:00:01`;
            try {
              const createdGw = await this.gatewayService.create({
                id: newGwId,
                name: `Gateway Jetson TX2 - Trạm ${stationIdNum}`,
                macAddress: mac,
                firmwareVersion: 'L4T-r32.7.3',
                description: `Gateway tự động khởi tạo cho Trạm ${stationIdNum}`,
                stationId: stationIdNum,
              });
              updateData.gatewayId = createdGw.id;
            } catch {
              const existingGw = await this.gatewayService.findById(newGwId).catch(() => null);
              if (existingGw) updateData.gatewayId = existingGw.id;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.nodeRepo.update(id, updateData);
    }

    const updated = await this.findById(id);
    if (updated.gatewayId || existing.gatewayId) {
      this.gatewayService
        .publishGatewayConfig(updated.gatewayId || existing.gatewayId)
        .catch(() => {});
    }

    // Chuyển hướng luồng dữ liệu cảm biến sang Station mới ngay lập tức
    if (updated.gateway?.stationId) {
      this.sensorService.updateNodeStationMapping(
        updated.id,
        updated.gateway.stationId,
        updated.gateway.station?.damId,
      );
    }

    return updated;
  }

  async delete(id: string): Promise<{ ok: boolean }> {
    const node = await this.findById(id);
    const gatewayId = node.gatewayId;
    await this.nodeRepo.remove(node);
    if (gatewayId) {
      this.gatewayService.publishGatewayConfig(gatewayId).catch(() => {});
    }
    return { ok: true };
  }

  /**
   * Map a node to a camera — used by the Jetson to know which camera
   * to trigger when this node detects an anomaly.
   */
  async mapCamera(
    nodeId: string,
    cameraId: string | null,
  ): Promise<Node> {
    const node = await this.findById(nodeId);
    if (cameraId) await this.assertCameraExists(cameraId);
    await this.nodeRepo.update(nodeId, { mappedCameraId: cameraId });
    const updated = await this.findById(nodeId);
    if (updated.gatewayId) {
      this.gatewayService.publishGatewayConfig(updated.gatewayId).catch(() => {});
    }
    return updated;
  }

  // ── Online status update (called by telemetry ingestion) ──
  async updateOnlineStatus(nodeId: string, lastSeenAt: Date): Promise<void> {
    try {
      await this.nodeRepo.update(nodeId, { status: 'online', lastSeenAt });
    } catch {
      // Node not registered — ignore silently for backward compatibility
    }
  }

  // ── Heartbeat Cronjob: Tự động kiểm tra & hạ trạng thái Node về OFFLINE nếu không nhận tín hiệu quá 30s ──
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleHeartbeatCheck(): Promise<void> {
    const TIMEOUT_MS = 30 * 1000;
    const now = Date.now();
    try {
      const onlineNodes = await this.nodeRepo.find({ where: { status: 'online' } });
      for (const node of onlineNodes) {
        const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).getTime() : 0;
        if (now - lastSeen > TIMEOUT_MS) {
          await this.nodeRepo.update(node.id, { status: 'offline' });
          console.log(
            `[HeartbeatCron] Sensor Node "${node.id}" không gửi tín hiệu trong 30s (lần cuối: ${node.lastSeenAt ? new Date(node.lastSeenAt).toISOString() : 'chưa gửi'}). Đã chuyển sang OFFLINE.`,
          );
        }
      }
    } catch (err: any) {
      console.warn('[HeartbeatCron] Lỗi khi kiểm tra heartbeat Node:', err.message);
    }
  }

  // ── Sensor CRUD ──

  async findSensorsByNode(nodeId: string): Promise<Sensor[]> {
    await this.findById(nodeId); // Ensure node exists
    return this.sensorRepo.find({
      where: { nodeId },
      order: { createdAt: 'ASC' },
    });
  }

  async addSensor(nodeId: string, dto: CreateSensorDto): Promise<Sensor> {
    validateDeviceId('SENSOR', dto.id);
    validateSensorType(dto.sensorType);

    await this.findById(nodeId); // Ensure node exists

    const existing = await this.sensorRepo.findOne({
      where: { id: dto.id },
    });
    if (existing) {
      throw new ConflictException(
        `Sensor "${dto.id}" đã tồn tại trên hệ thống.`,
      );
    }

    const sensor = this.sensorRepo.create({ ...dto, nodeId });
    return this.sensorRepo.save(sensor);
  }

  async updateSensor(
    sensorId: string,
    dto: UpdateSensorDto,
  ): Promise<Sensor> {
    const sensor = await this.sensorRepo.findOne({
      where: { id: sensorId },
    });
    if (!sensor) {
      throw new NotFoundException(`Sensor "${sensorId}" không tồn tại.`);
    }
    await this.sensorRepo.update(sensorId, dto);
    return this.sensorRepo.findOneOrFail({ where: { id: sensorId } });
  }

  async removeSensor(sensorId: string): Promise<{ ok: boolean }> {
    const sensor = await this.sensorRepo.findOne({
      where: { id: sensorId },
    });
    if (!sensor) {
      throw new NotFoundException(`Sensor "${sensorId}" không tồn tại.`);
    }
    await this.sensorRepo.remove(sensor);
    return { ok: true };
  }
}
