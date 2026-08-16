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
import { ThresholdConfig } from '../sensor/entities/threshold-config.entity';
import { Station } from '../dam/entities/station.entity';
import {
  CreateNodeDto,
  UpdateNodeDto,
  CreateSensorDto,
  UpdateSensorDto,
} from './node.dto';
import {
  validateDeviceId,
  validateSensorType,
  normalizeSensorType,
} from '../common/validators/naming-convention.validator';
import { GatewayService } from '../gateway/gateway.service';
import { Gateway } from '../gateway/entities/gateway.entity';
import { SensorService } from '../sensor/sensor.service';
import { SensorGateway } from '../gateway/sensor.gateway';
import { CameraService } from '../camera/camera.service';
import { Camera } from '../camera/entities/camera.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

// `gateway: { station: { dam: true } }` cần thiết để @AfterLoad điền node.gatewayId,
// gateway.stationId và station.damId — controller/service phía trên đều đọc các trường này.
const NODE_RELATIONS = {
  sensors: true,
  mappedCamera: true,
  gateway: { station: { dam: true } },
} as const;

@Injectable()
export class NodeService {
  constructor(
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Sensor)
    private readonly sensorRepo: Repository<Sensor>,
    @InjectRepository(ThresholdConfig)
    private readonly thresholdConfigRepo: Repository<ThresholdConfig>,
    @InjectRepository(Station)
    private readonly stationRepo: Repository<Station>,
    private readonly gatewayService: GatewayService,
    private readonly sensorService: SensorService,
    private readonly sensorGateway: SensorGateway,
    private readonly cameraService: CameraService,
    private readonly auditLogService: AuditLogService,
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

  /**
   * Sinh MAC placeholder duy nhất từ mã node khi người dùng không khai báo.
   * Octet đầu 0x02 = địa chỉ cục bộ (locally administered) nên không đụng MAC thật của nhà sản xuất.
   */
  private generatePlaceholderMac(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const octets = [
      (h >>> 24) & 0xff,
      (h >>> 16) & 0xff,
      (h >>> 8) & 0xff,
      h & 0xff,
      seed.length & 0xff,
    ];
    return ['02', ...octets.map(o => o.toString(16).padStart(2, '0').toUpperCase())].join(':');
  }

  /** Tra ThresholdConfig rung động của Đập chứa Gateway này (nguồn ngưỡng duy nhất, cấp Đập). */
  private async findDamVibrationConfig(gatewayId?: string): Promise<ThresholdConfig | null> {
    if (!gatewayId) return null;
    try {
      const gw = await this.gatewayService.findById(gatewayId);
      const damId = gw.station?.damId;
      if (!damId) return null;
      return await this.thresholdConfigRepo.findOne({ where: { damId, sensorType: 'vibration' } });
    } catch {
      return null;
    }
  }

  /** Trả về bản ghi Camera (cần `.id` để gán vào Node.mappedCameraRefId). */
  private async assertCameraExists(cameraId: string): Promise<Camera> {
    try {
      return await this.cameraService.findById(cameraId);
    } catch {
      throw new BadRequestException(
        `Camera "${cameraId}" không tồn tại, không thể gán cho node.`,
      );
    }
  }

  /**
   * Tìm (hoặc tự tạo) Gateway phục vụ một Trạm, trả về mã gateway.
   * Dùng khi client chỉ gửi stationId mà không chỉ định gateway cụ thể.
   */
  private async resolveGatewayIdForStation(stationId: string): Promise<string | undefined> {
    const station = await this.stationRepo.findOne({ where: { stationId } });
    if (!station) return undefined;

    const gwList = await this.gatewayService.findAll(station.stationId);
    if (gwList && gwList.length > 0) return gwList[0].gatewayId;

    // Quy tắc đặt tên gateway chỉ có một nguồn duy nhất — GatewayService.nextGatewayId().
    const newGwId = await this.gatewayService.nextGatewayId(station);
    try {
      const createdGw = await this.gatewayService.create({
        gatewayId: newGwId,
        name: `Gateway Jetson TX2 - ${station.name}`,
        macAddress: `00:04:4B:${String(station.id % 256).padStart(2, '0')}:00:01`,
        firmwareVersion: 'L4T-r32.7.3',
        description: `Gateway tự động khởi tạo cho ${station.name}`,
        stationId: station.stationId,
      });
      return createdGw.gatewayId;
    } catch {
      const existingGw = await this.gatewayService.findById(newGwId).catch(() => null);
      return existingGw?.gatewayId;
    }
  }

  /**
   * Sinh mã node NOD-[GW_SEQ]-ESP[SEQ] — gắn theo GATEWAY, KHÔNG nhắc gì đến trạm/đập.
   *
   * GW_SEQ lấy từ khoá chính kỹ thuật `gateway.id` (surrogate, không đổi suốt vòng đời gateway),
   * chứ không phải từ `gateway.gatewayId` (chuỗi mã có thể tự đổi khi gateway chuyển trạm — xem
   * GatewayService.update). Nhờ vậy mã node CHỈ đổi khi chính node đó được gán sang một gateway
   * khác, không bị ảnh hưởng khi gateway cha đổi trạm.
   *
   * SEQ đánh số trong phạm vi GW_SEQ (không đếm toàn hệ thống) — mỗi gateway có dải ESP01, ESP02...
   * riêng, nếu không node đầu tiên của một gateway mới sẽ mang số thứ tự vô nghĩa.
   */
  private async nextNodeId(gateway: Gateway): Promise<string> {
    const gwSeq = `GW${String(gateway.id).padStart(2, '0')}`;
    const prefix = `NOD-${gwSeq}-ESP`;
    const siblings = await this.nodeRepo.find({ select: { nodeId: true } });
    let max = 0;
    for (const n of siblings) {
      if (!n.nodeId?.startsWith(prefix)) continue;
      const seq = parseInt(n.nodeId.slice(prefix.length), 10);
      if (!isNaN(seq)) max = Math.max(max, seq);
    }
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  }

  // ── Node CRUD ──

  async findAll(gatewayId?: string, stationId?: string, damId?: string): Promise<Node[]> {
    const qb = this.nodeRepo.createQueryBuilder('node')
      .leftJoinAndSelect('node.sensors', 'sensors')
      .leftJoinAndSelect('node.mappedCamera', 'mappedCamera')
      .leftJoinAndSelect('node.gateway', 'gateway')
      .leftJoinAndSelect('gateway.station', 'station')
      .leftJoinAndSelect('station.dam', 'dam')
      .orderBy('node.createdAt', 'ASC');

    if (gatewayId) {
      qb.andWhere('gateway.gatewayId = :gatewayId', { gatewayId });
    }
    if (stationId) {
      qb.andWhere('station.stationId = :stationId', { stationId });
    }
    if (damId && damId !== 'all') {
      qb.andWhere('dam.damId = :damId', { damId });
    }

    return qb.getMany();
  }

  async findById(nodeId: string): Promise<Node> {
    const node = await this.nodeRepo.findOne({
      where: { nodeId },
      relations: NODE_RELATIONS,
    });
    if (!node) throw new NotFoundException(`Node "${nodeId}" không tồn tại.`);
    return node;
  }

  async create(dto: CreateNodeDto): Promise<Node> {
    let gatewayId = dto.gatewayId;
    if (!gatewayId && dto.stationId) {
      gatewayId = await this.resolveGatewayIdForStation(dto.stationId);
    }
    if (!gatewayId) {
      gatewayId = 'GTW-ST01-TX2A';
    }

    const gateway = await this.gatewayService.findById(gatewayId);

    const nodeId = dto.nodeId?.trim() || (await this.nextNodeId(gateway));

    validateDeviceId('NODE', nodeId);

    const existing = await this.nodeRepo.findOne({ where: { nodeId } });
    if (existing) {
      throw new ConflictException(
        `Node "${nodeId}" đã tồn tại trên hệ thống.`,
      );
    }

    // Ngưỡng rung là giá trị CẤP ĐẬP (ThresholdConfig) — node mới phải kế thừa cấu hình hiện hành
    // của đập, không dùng số mặc định cứng, nếu không node mới sẽ chạy ngưỡng khác các node anh em.
    const damVibCfg = await this.findDamVibrationConfig(gatewayId);

    const node = new Node();
    node.nodeId = nodeId;
    node.name = dto.name;
    // MAC có ràng buộc UNIQUE — không dùng hằng số mặc định, nếu không node thứ hai bỏ trống MAC
    // sẽ lỗi trùng khoá. Sinh MAC cục bộ (locally administered) từ mã node để luôn khác nhau.
    node.macAddress = dto.macAddress || dto.espMacAddress || this.generatePlaceholderMac(nodeId);
    if (dto.description) node.description = dto.description;
    node.firmwareVersion = dto.firmwareVersion || 'v1.0.0';
    if (dto.installLocation) node.installLocation = dto.installLocation;
    node.vibrationThreshold = dto.vibrationThreshold != null ? Number(dto.vibrationThreshold) : (damVibCfg?.alertHigh ?? 15.0);
    node.warnHigh = dto.warnHigh != null ? Number(dto.warnHigh) : (damVibCfg?.warnHigh ?? 2.5);
    node.criticalHigh = dto.criticalHigh != null ? Number(dto.criticalHigh) : (damVibCfg?.criticalHigh ?? 25.0);
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

    node.gatewayRefId = gateway.id;
    if (dto.mappedCameraId) {
      const camera = await this.assertCameraExists(dto.mappedCameraId);
      node.mappedCameraRefId = camera.id;
    }

    await this.nodeRepo.save(node);
    const createdNode = await this.findById(nodeId);
    if (createdNode.gatewayId) {
      this.gatewayService.publishGatewayConfig(createdNode.gatewayId).catch(() => {});
    }
    if (createdNode.gateway?.stationId) {
      this.sensorService.updateNodeStationMapping(
        createdNode.nodeId,
        createdNode.gateway.stationId,
        createdNode.gateway.station?.damId,
      );
      const changes = this.sensorService.drainStatusChanges();
      for (const c of changes) {
        this.sensorGateway.broadcastStationStatus(c);
      }
    }
    return createdNode;
  }

  /**
   * Cập nhật Node. Khi Node được gán sang GATEWAY khác (kể cả gián tiếp qua `stationId` cũ),
   * mã Node được SINH LẠI theo gateway mới (NOD-[GW_SEQ_MỚI]-ESPxx) để không còn "nói dối" nó
   * đang thuộc gateway nào — cùng triết lý với GatewayService.update() đổi mã theo trạm mới.
   *
   * QUAN TRỌNG: node ESP32 vật lý tự lưu mã của chính nó để publish MQTT
   * (`telemetry/gateway/{gw}/node/{id}/...`). Đổi mã ở backend KHÔNG tự cập nhật xuống thiết bị —
   * phải cấu hình lại thiết bị thủ công sau khi đổi gateway, nếu không nó sẽ mất kết nối.
   */
  async update(
    nodeId: string,
    dto: UpdateNodeDto,
  ): Promise<{ node: Node; renamedFrom?: string }> {
    const existing = await this.findById(nodeId);

    const updateData: Partial<Node> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.macAddress !== undefined) updateData.macAddress = dto.macAddress;
    else if (dto.espMacAddress !== undefined) updateData.macAddress = dto.espMacAddress;

    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.firmwareVersion !== undefined) updateData.firmwareVersion = dto.firmwareVersion;
    if (dto.installLocation !== undefined) updateData.installLocation = dto.installLocation;
    if (dto.status !== undefined) updateData.status = dto.status;

    // Xác định gateway đích (ưu tiên gatewayId tường minh, rồi mới tới stationId để tương thích
    // ngược) — nếu khác gateway hiện tại (so theo khoá chính, không so theo chuỗi mã), sinh lại
    // mã Node theo gateway mới.
    let targetGateway: Gateway | undefined;
    if (dto.gatewayId !== undefined) {
      targetGateway = await this.gatewayService.findById(dto.gatewayId);
    } else if (dto.stationId) {
      const resolvedGatewayId = await this.resolveGatewayIdForStation(dto.stationId);
      if (resolvedGatewayId) {
        targetGateway = await this.gatewayService.findById(resolvedGatewayId);
      }
    }

    let targetNodeId = nodeId;
    let renamedFrom: string | undefined;
    if (targetGateway && targetGateway.id !== existing.gateway?.id) {
      updateData.gatewayRefId = targetGateway.id;
      updateData.nodeId = await this.nextNodeId(targetGateway);
      targetNodeId = updateData.nodeId;
      renamedFrom = nodeId;
    }

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
      updateData.mappedCameraRefId = dto.mappedCameraId
        ? (await this.assertCameraExists(dto.mappedCameraId)).id
        : null;
    }

    if (Object.keys(updateData).length > 0) {
      await this.nodeRepo.update({ nodeId }, updateData);
    }

    const updated = await this.findById(targetNodeId);
    const configTargetGatewayId = updated.gatewayId || existing.gatewayId;
    if (configTargetGatewayId) {
      this.gatewayService.publishGatewayConfig(configTargetGatewayId).catch(() => {});
    }

    // Đổi gateway (nên mã Node bị sinh lại) — dọn cache trong SensorService đang khoá theo mã
    // CŨ (trạng thái rung mới nhất, chỉ số Node -> Trạm...) trước khi đăng ký lại dưới mã mới,
    // nếu không các Map trong bộ nhớ sẽ giữ rác dưới khoá cũ vĩnh viễn cho tới khi restart.
    if (renamedFrom) {
      await this.sensorService.unregisterNode(renamedFrom, existing.gateway?.stationId);
      await this.auditLogService.logAction({
        action: 'RENAME_NODE',
        category: 'GATEWAY',
        description: `Node đổi gateway nên đổi mã: "${renamedFrom}" → "${updated.nodeId}" (gateway mới: ${updated.gatewayId}). Cần cấu hình lại thiết bị ESP32 vật lý.`,
        username: 'admin',
        userRole: 'ADMIN',
        metadata: { oldNodeId: renamedFrom, newNodeId: updated.nodeId, gatewayId: updated.gatewayId },
      });
    }

    // Chuyển hướng luồng dữ liệu cảm biến sang Station mới ngay lập tức
    if (updated.gateway?.stationId) {
      this.sensorService.updateNodeStationMapping(
        updated.nodeId,
        updated.gateway.stationId,
        updated.gateway.station?.damId,
      );
    }

    const changes = this.sensorService.drainStatusChanges();
    for (const c of changes) {
      this.sensorGateway.broadcastStationStatus(c);
    }

    // Đồng bộ ngược ngưỡng độ rung sang ThresholdConfig của Đập — CHỈ khi 3 giá trị ngưỡng được
    // gửi lên tường minh. Nếu gate bằng thresholdFieldsChanged (bao gồm cả alertMinCount /
    // alertMinDurationSec) thì chỉ sửa tham số episode cũng ghi đè ngưỡng cấp Đập bằng giá trị
    // cũ của riêng node này.
    const vibrationValuesProvided =
      dto.warnHigh !== undefined ||
      dto.vibrationThreshold !== undefined ||
      dto.criticalHigh !== undefined;

    if (vibrationValuesProvided) {
      const damId = updated.gateway?.station?.damId;
      if (damId) {
        try {
          const vibCfg = await this.thresholdConfigRepo.findOne({
            where: { damId, sensorType: 'vibration' },
          });
          if (vibCfg) {
            vibCfg.warnHigh = effectiveWarnHigh;
            vibCfg.alertHigh = effectiveAlertHigh;
            vibCfg.criticalHigh = effectiveCriticalHigh;
            await this.thresholdConfigRepo.save(vibCfg);
            console.log(`[NodeService] Đã đồng bộ ngược ngưỡng độ rung từ Node ${nodeId} sang ThresholdConfig Đập ${damId}`);
          }
        } catch (err: any) {
          console.warn('[NodeService] Lỗi đồng bộ ngược ThresholdConfig:', err.message);
        }
      }
    }

    return { node: updated, renamedFrom };
  }

  async delete(nodeId: string): Promise<{ ok: boolean }> {
    const node = await this.findById(nodeId);
    const gatewayId = node.gatewayId;
    const stationId = node.gateway?.stationId;
    await this.nodeRepo.remove(node);
    if (gatewayId) {
      this.gatewayService.publishGatewayConfig(gatewayId).catch(() => {});
    }
    await this.sensorService.unregisterNode(nodeId, stationId);
    const changes = this.sensorService.drainStatusChanges();
    for (const c of changes) {
      this.sensorGateway.broadcastStationStatus(c);
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
    await this.findById(nodeId);
    const mappedCameraRefId = cameraId
      ? (await this.assertCameraExists(cameraId)).id
      : null;
    await this.nodeRepo.update({ nodeId }, { mappedCameraRefId });
    const updated = await this.findById(nodeId);
    if (updated.gatewayId) {
      this.gatewayService.publishGatewayConfig(updated.gatewayId).catch(() => {});
    }
    return updated;
  }

  // ── Online status update (called by telemetry ingestion) ──
  async updateOnlineStatus(nodeId: string, lastSeenAt: Date): Promise<void> {
    try {
      await this.nodeRepo.update({ nodeId }, { status: 'online', lastSeenAt });
      await this.sensorService.handleNodeStatusChanged(nodeId, 'online');
      const changes = this.sensorService.drainStatusChanges();
      for (const c of changes) {
        this.sensorGateway.broadcastStationStatus(c);
      }
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
            `[HeartbeatCron] Sensor Node "${node.nodeId}" không gửi tín hiệu trong 30s (lần cuối: ${node.lastSeenAt ? new Date(node.lastSeenAt).toISOString() : 'chưa gửi'}). Đã chuyển sang OFFLINE.`,
          );
          await this.sensorService.handleNodeStatusChanged(node.nodeId, 'offline');
          const changes = this.sensorService.drainStatusChanges();
          for (const c of changes) {
            this.sensorGateway.broadcastStationStatus(c);
          }
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
      where: { node: { nodeId } },
      relations: { node: true },
      order: { createdAt: 'ASC' },
    });
  }

  async addSensor(nodeId: string, dto: CreateSensorDto): Promise<Sensor> {
    const sensorType = normalizeSensorType(dto.sensorType);
    validateSensorType(sensorType);

    const node = await this.findById(nodeId); // Ensure node exists

    const { sensorId: requestedId, port, ...rest } = dto;
    const sensorId = requestedId?.trim() || this.buildSensorId(node, sensorType, port);
    validateDeviceId('SENSOR', sensorId);

    const existing = await this.sensorRepo.findOne({ where: { sensorId } });
    if (existing) {
      throw new ConflictException(
        `Sensor "${sensorId}" đã tồn tại trên hệ thống.`,
      );
    }

    const sensor = this.sensorRepo.create({
      ...rest,
      sensorId,
      sensorType,
      nodeRefId: node.id,
    });
    await this.sensorRepo.save(sensor);
    return this.sensorRepo.findOneOrFail({
      where: { sensorId },
      relations: { node: true },
    });
  }

  /**
   * Sinh mã cảm biến SNR-[SENSOR_TYPE]-[NODE_SEQ]-[PORT].
   * NODE_SEQ lấy đoạn cuối của mã node (NOD-GW01-ESP01 -> ESP01); PORT mặc định P01, P02...
   */
  private buildSensorId(node: Node, sensorType: string, port?: string): string {
    const nodeSeq = node.nodeId.split('-').pop() || 'ESP01';
    const seq = (node.sensors?.length ?? 0) + 1;
    const portCode = (port?.trim() || `P${String(seq).padStart(2, '0')}`).toUpperCase();
    return `SNR-${sensorType}-${nodeSeq}-${portCode}`;
  }

  async updateSensor(
    sensorId: string,
    dto: UpdateSensorDto,
  ): Promise<Sensor> {
    const sensor = await this.sensorRepo.findOne({
      where: { sensorId },
    });
    if (!sensor) {
      throw new NotFoundException(`Sensor "${sensorId}" không tồn tại.`);
    }
    await this.sensorRepo.update({ sensorId }, dto);
    return this.sensorRepo.findOneOrFail({
      where: { sensorId },
      relations: { node: true },
    });
  }

  async removeSensor(sensorId: string): Promise<{ ok: boolean }> {
    const sensor = await this.sensorRepo.findOne({
      where: { sensorId },
    });
    if (!sensor) {
      throw new NotFoundException(`Sensor "${sensorId}" không tồn tại.`);
    }
    await this.sensorRepo.remove(sensor);
    return { ok: true };
  }
}
