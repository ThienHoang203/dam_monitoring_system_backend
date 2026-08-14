import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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

@Injectable()
export class NodeService {
  constructor(
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Sensor)
    private readonly sensorRepo: Repository<Sensor>,
    private readonly gatewayService: GatewayService,
    private readonly sensorService: SensorService,
  ) {}

  // ── Node CRUD ──

  async findAll(gatewayId?: string): Promise<Node[]> {
    const where: any = {};
    if (gatewayId) where.gatewayId = gatewayId;
    return this.nodeRepo.find({
      where,
      relations: { sensors: true, mappedCamera: true, gateway: { station: true } },
      order: { createdAt: 'ASC' },
    });
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
    node.gatewayId = gatewayId;
    if (dto.mappedCameraId) node.mappedCameraId = dto.mappedCameraId;

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
    if (dto.vibrationThreshold !== undefined) updateData.vibrationThreshold = Number(dto.vibrationThreshold);
    if (dto.gatewayId !== undefined) updateData.gatewayId = dto.gatewayId;
    if (dto.mappedCameraId !== undefined) updateData.mappedCameraId = dto.mappedCameraId;

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
