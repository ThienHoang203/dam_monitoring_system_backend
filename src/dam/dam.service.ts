import { Injectable, OnModuleInit, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dam } from './entities/dam.entity';
import { Station } from './entities/station.entity';
import { CreateDamDto, UpdateDamDto, CreateStationDto, UpdateStationDto } from './dam.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { validateDeviceId } from '../common/validators/naming-convention.validator';

import { Gateway } from '../gateway/entities/gateway.entity';
import { Camera } from '../camera/entities/camera.entity';
import { Node } from '../node/entities/node.entity';
import { Sensor } from '../node/entities/sensor.entity';
import { SensorService } from '../sensor/sensor.service';

// Quan hệ cần load khi trả Station ra API: `dam` để @AfterLoad điền được station.damId,
// phần còn lại để frontend dựng cây thiết bị. `mappedCamera` phải khai báo tường minh vì
// TypeORM chỉ tự áp dụng quan hệ eager ở cấp gốc, không áp dụng trong nhánh lồng nhau.
const STATION_RELATIONS = {
  dam: true,
  gateways: { nodes: { sensors: true, mappedCamera: true }, cameras: true },
} as const;

@Injectable()
export class DamService implements OnModuleInit {
  constructor(
    @InjectRepository(Dam)
    private readonly damRepo: Repository<Dam>,
    @InjectRepository(Station)
    private readonly stationRepo: Repository<Station>,
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
    @InjectRepository(Camera)
    private readonly cameraRepo: Repository<Camera>,
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Sensor)
    private readonly sensorRepo: Repository<Sensor>,
    private readonly auditLogService: AuditLogService,
    private readonly sensorService: SensorService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultData();
  }

  // ── Sinh mã theo quy tắc đặt tên A.3.2 ──

  /** Số thứ tự lớn nhất đang dùng trong các mã dạng PREFIX-### → trả về số kế tiếp. */
  private async nextDamSequence(): Promise<number> {
    const dams = await this.damRepo.find({ select: { damId: true } });
    let max = 0;
    for (const d of dams) {
      const m = /^DAM-(\d{3})$/.exec(d.damId || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  }

  /** Mã đập DAM-001 → phần số '001', dùng làm DAM_CODE trong mã trạm STA-[DAM_CODE]-[XX]. */
  private damCodeOf(damId: string): string {
    const m = /^DAM-(\d{3})$/.exec(damId);
    return m ? m[1] : '000';
  }

  /** Sinh mã trạm STA-[DAM_CODE]-[XX] với XX là số thứ tự trạm trong chính đập đó. */
  private async nextStationId(dam: Dam): Promise<string> {
    const siblings = await this.stationRepo.find({
      where: { damRefId: dam.id },
      select: { stationId: true },
    });
    const damCode = this.damCodeOf(dam.damId);
    let max = 0;
    for (const s of siblings) {
      const m = new RegExp(`^STA-${damCode}-(\\d{2})$`).exec(s.stationId || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `STA-${damCode}-${String(max + 1).padStart(2, '0')}`;
  }

  /**
   * Sinh STATION_CODE ngắn (ST01, ST02...) — mã này được nhúng vào id gateway/node
   * (GTW-ST01-TX2A) nên phải duy nhất trên TOÀN hệ thống, không chỉ trong một đập.
   */
  private async nextStationCode(): Promise<string> {
    const all = await this.stationRepo.find({ select: { stationCode: true } });
    let max = 0;
    for (const s of all) {
      const m = /^ST(\d{2,})$/.exec(s.stationCode || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `ST${String(max + 1).padStart(2, '0')}`;
  }

  // ── Resolve mã → bản ghi (khóa chính kỹ thuật nằm ở .id) ──

  async resolveDamRef(damId: string): Promise<Dam> {
    const dam = await this.damRepo.findOne({ where: { damId } });
    if (!dam) throw new NotFoundException(`Đập "${damId}" không tồn tại.`);
    return dam;
  }

  async resolveStationRef(stationId: string): Promise<Station> {
    const station = await this.stationRepo.findOne({ where: { stationId } });
    if (!station) throw new NotFoundException(`Trạm "${stationId}" không tồn tại.`);
    return station;
  }

  // ── Seed dữ liệu mẫu ──

  async seedDefaultData() {
    const count = await this.damRepo.count();
    if (count > 0) {
      await this.seedDefaultDevices();
      return;
    }

    console.log('[DamService] Seeding default Dam and Station data...');

    const damsData = [
      { damId: 'DAM-001', name: 'Đập Thủy điện Hòa Bình', location: 'Hòa Bình', latitude: 20.8167, longitude: 105.3265, status: 'safe', waterLevel: 105.2, flow: 1200, fillPct: 78 },
      { damId: 'DAM-002', name: 'Đập Sơn La', location: 'Sơn La', latitude: 21.5622, longitude: 103.9781, status: 'warning', waterLevel: 212.5, flow: 3450, fillPct: 88 },
      { damId: 'DAM-003', name: 'Đập Lai Châu', location: 'Lai Châu', latitude: 22.1464, longitude: 103.0189, status: 'safe', waterLevel: 295.1, flow: 850, fillPct: 65 },
      { damId: 'DAM-004', name: 'Đập Tuyên Quang', location: 'Tuyên Quang', latitude: 22.3556, longitude: 105.3853, status: 'safe', waterLevel: 118.3, flow: 620, fillPct: 72 },
    ];

    const damByCode = new Map<string, Dam>();
    for (const d of damsData) {
      const dam = await this.damRepo.save(this.damRepo.create(d));
      damByCode.set(dam.damId, dam);
    }

    const stationsData = [
      { stationId: 'STA-001-01', stationCode: 'ST01', name: 'Trạm Tân Ấp 1', location: 'Hoàn Kiếm, Hà Nội', latitude: 21.0381, longitude: 105.8492, river: 'Sông Hồng', km: 'K25+500', status: 'danger', waterLevel: 12.5, change: 0.4, pressure: 450, flow: 3200, humidity: 78, damId: 'DAM-001' },
      { stationId: 'STA-001-02', stationCode: 'ST02', name: 'Trạm Nhật Tân', location: 'Tây Hồ, Hà Nội', latitude: 21.0825, longitude: 105.8194, river: 'Sông Hồng', km: 'K32+200', status: 'warning', waterLevel: 9.8, change: 0.1, pressure: 280, flow: 2100, humidity: 62, damId: 'DAM-001' },
      { stationId: 'STA-001-03', stationCode: 'ST03', name: 'Trạm Long Biên', location: 'Long Biên, Hà Nội', latitude: 21.0428, longitude: 105.8617, river: 'Sông Hồng', km: 'K18+000', status: 'safe', waterLevel: 6.2, change: -0.2, pressure: 120, flow: 1400, humidity: 45, damId: 'DAM-001' },
      { stationId: 'STA-002-01', stationCode: 'ST04', name: 'Trạm Sơn Tây', location: 'Sơn Tây, Hà Nội', latitude: 21.1415, longitude: 105.5034, river: 'Sông Đà', km: 'K45+000', status: 'warning', waterLevel: 8.1, change: 0.5, pressure: 310, flow: 2450, humidity: 58, damId: 'DAM-002' },
      { stationId: 'STA-001-04', stationCode: 'ST05', name: 'Trạm Hà Nội', location: 'Hoàn Kiếm, Hà Nội', latitude: 21.0285, longitude: 105.8542, river: 'Sông Hồng', km: 'K120+000', status: 'warning', waterLevel: 6.12, change: 0.05, pressure: 200, flow: 1800, humidity: 52, damId: 'DAM-001' },
      { stationId: 'STA-001-05', stationCode: 'ST06', name: 'Trạm Hưng Yên', location: 'Hưng Yên', latitude: 20.6464, longitude: 106.0511, river: 'Sông Hồng', km: 'TR-HY-01', status: 'danger', waterLevel: 7.45, change: 0.3, pressure: 380, flow: 2800, humidity: 71, damId: 'DAM-001' },
      { stationId: 'STA-001-06', stationCode: 'ST07', name: 'Trạm Quan Trắc K25+500 (Thân Đập)', damId: 'DAM-001', latitude: 20.8170, longitude: 105.3270, location: 'K25+500', river: 'Sông Đà', km: 'KM 25' },
      { stationId: 'STA-001-07', stationCode: 'ST08', name: 'Trạm Quan Trắc Cống Xả Lũ Số 1', damId: 'DAM-001', latitude: 20.8155, longitude: 105.3250, location: 'Cống xả lũ', river: 'Sông Đà', km: 'KM 26' },
      { stationId: 'STA-002-02', stationCode: 'ST09', name: 'Trạm Quan Trắc Thân Đập Chính Sơn La', damId: 'DAM-002', latitude: 21.3290, longitude: 103.9050, location: 'Mặt đập chính', river: 'Sông Đà', km: 'KM 110' },
    ];

    for (const { damId, ...st } of stationsData) {
      const dam = damByCode.get(damId);
      if (!dam) continue;
      await this.stationRepo.save(this.stationRepo.create({ ...st, damRefId: dam.id }));
    }

    await this.seedDefaultDevices();
  }

  async seedDefaultDevices() {
    const gwCount = await this.gatewayRepo.count();
    if (gwCount > 0) return;

    console.log('[DamService] Seeding default IoT physical devices (Gateway, Camera, Node, Sensors)...');

    const station = await this.stationRepo.findOne({ where: { stationCode: 'ST01' } });
    if (!station) {
      console.warn('[DamService] Không tìm thấy trạm ST01, bỏ qua seed thiết bị IoT.');
      return;
    }

    // 1. Gateway GTW-ST01-TX2A cho trạm ST01
    const gw = await this.gatewayRepo.save(this.gatewayRepo.create({
      gatewayId: 'GTW-ST01-TX2A',
      name: 'Gateway Jetson TX2 - Trạm 01',
      macAddress: 'AA:BB:CC:DD:EE:01',
      firmwareVersion: 'v2.1.0',
      description: 'Gateway AI Jetson TX2 tại Trạm Tân Ấp 1',
      stationRefId: station.id,
      status: 'offline',
    }));

    // 2. Camera CAM-CSI-ST01-01 cho GTW-ST01-TX2A
    const cam = await this.cameraRepo.save(this.cameraRepo.create({
      cameraId: 'CAM-CSI-ST01-01',
      cameraType: 'CSI',
      name: 'Camera CSI - Jetson TX2 Trạm 01',
      resolution: '1280x720',
      gatewayRefId: gw.id,
      status: 'active',
    }));

    // 3. Node cho GTW-ST01-TX2A, gán tới CAM-CSI-ST01-01. Mã node gắn theo GATEWAY (khoá chính
    // gw.id, KHÔNG nhắc gì đến trạm/đập) — xem NodeService.nextNodeId để hiểu quy tắc chuẩn.
    const node = await this.nodeRepo.save(this.nodeRepo.create({
      nodeId: `NOD-GW${String(gw.id).padStart(2, '0')}-ESP01`,
      name: 'Node ESP32 #01 - K25+500',
      macAddress: 'AA:BB:CC:DD:EE:02',
      firmwareVersion: 'v1.0.0',
      installLocation: 'Thân đập chính - K25+500',
      vibrationThreshold: 15.0,
      gatewayRefId: gw.id,
      mappedCameraRefId: cam.id,
      status: 'offline',
    }));

    // 4. Sensors của node vừa seed
    const sensors = [
      { sensorId: 'SNR-VIB-ESP01-I2C1', sensorType: 'VIB', model: 'MPU6050', unit: 'mm/s' },
      { sensorId: 'SNR-WTL-ESP01-ADC1', sensorType: 'WTL', model: 'HC-SR04', unit: 'cm' },
      { sensorId: 'SNR-MST-ESP01-ADC2', sensorType: 'MST', model: 'Capacitive v1.2', unit: '%' },
    ];

    for (const s of sensors) {
      await this.sensorRepo.save(this.sensorRepo.create({ ...s, nodeRefId: node.id }));
    }

    console.log('[DamService] IoT devices seeded successfully!');
  }

  // ── Dam CRUD (định danh công khai = damId) ──

  async findAllDams(): Promise<Dam[]> {
    return this.damRepo.find({ relations: { stations: { dam: true } } });
  }

  async findDamById(damId: string): Promise<Dam> {
    const dam = await this.damRepo.findOne({
      where: { damId },
      relations: { stations: { dam: true } },
    });
    if (!dam) throw new NotFoundException(`Dam with id ${damId} not found`);
    return dam;
  }

  async createDam(dto: CreateDamDto): Promise<Dam> {
    const { damId: requestedId, ...rest } = dto;
    let damId = requestedId ? requestedId.trim() : '';

    if (!damId) {
      damId = `DAM-${String(await this.nextDamSequence()).padStart(3, '0')}`;
    } else {
      validateDeviceId('DAM', damId);
      const existing = await this.damRepo.findOne({ where: { damId } });
      if (existing) {
        throw new ConflictException(`Mã đập thủy điện "${damId}" đã tồn tại trên hệ thống, không thể ghi đè!`);
      }
    }

    const dam = this.damRepo.create({
      ...rest,
      damId,
      status: 'unknown',
    });
    const saved = await this.damRepo.save(dam);

    // Đập mới phải có ngay bộ ngưỡng mặc định, nếu không sẽ không cảnh báo được
    // nước/độ ẩm và form sửa ngưỡng sẽ lưu không ăn (không có bản ghi để update).
    await this.sensorService.ensureThresholdConfigs(saved.damId);
    await this.sensorService.recomputeDamStatus(saved.damId);

    await this.auditLogService.logAction({
      action: 'CREATE_DAM',
      category: 'DAM',
      description: `Tạo mới Đập Thủy Điện "${saved.name}" (Mã: ${saved.damId}, Vị trí: ${saved.location || 'Chưa rõ'})`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    return await this.findDamById(saved.damId);
  }

  async updateDam(damId: string, dto: UpdateDamDto): Promise<Dam> {
    const oldDam = await this.findDamById(damId);
    await this.damRepo.update({ damId }, dto);
    const updatedDam = await this.findDamById(damId);

    await this.auditLogService.logAction({
      action: 'UPDATE_DAM',
      category: 'DAM',
      description: `Cập nhật thông tin Đập "${updatedDam.name}" (Mực nước: ${updatedDam.waterLevel}m, Trạng thái: ${updatedDam.status})`,
      username: 'admin',
      userRole: 'ADMIN',
      metadata: { old: oldDam, updated: updatedDam },
    });

    return updatedDam;
  }

  async deleteDam(damId: string): Promise<{ ok: boolean }> {
    const dam = await this.findDamById(damId);
    await this.damRepo.remove(dam);
    // ThresholdConfig không có khoá ngoại tới Dam nên phải dọn tay, tránh để lại bản ghi mồ côi.
    await this.sensorService.deleteThresholdConfigsByDam(damId);

    await this.auditLogService.logAction({
      action: 'DELETE_DAM',
      category: 'DAM',
      description: `Xóa Đập Thủy Điện "${dam.name}" (Mã: ${damId})`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    return { ok: true };
  }

  // ── Station CRUD (định danh công khai = stationId) ──
  async findAllStations(damId?: string): Promise<Station[]> {
    const stations = await this.stationRepo.find({
      where: damId ? { dam: { damId } } : {},
      relations: STATION_RELATIONS,
      order: { id: 'ASC' },
    });

    for (const st of stations) {
      const allNodes = (st.gateways || []).flatMap(g => g.nodes || []);
      if (allNodes.length === 0 && st.status !== 'unknown') {
        st.status = 'unknown';
        st.statusReason = 'Chưa gắn Sensor Node vào trạm';
        st.waterLevel = 0;
        st.humidity = 0;
        st.vibration = 0;
        this.stationRepo.update(st.id, {
          status: 'unknown',
          statusReason: 'Chưa gắn Sensor Node vào trạm',
          waterLevel: 0,
          humidity: 0,
          vibration: 0,
          change: 0,
        }).catch(() => {});
      }
    }

    return stations;
  }

  async findStationById(stationId: string): Promise<Station> {
    const station = await this.stationRepo.findOne({
      where: { stationId },
      relations: STATION_RELATIONS,
    });
    if (!station) throw new NotFoundException(`Station with id ${stationId} not found`);

    const allNodes = (station.gateways || []).flatMap(g => g.nodes || []);
    if (allNodes.length === 0 && station.status !== 'unknown') {
      station.status = 'unknown';
      station.statusReason = 'Chưa gắn Sensor Node vào trạm';
      station.waterLevel = 0;
      station.humidity = 0;
      station.vibration = 0;
      this.stationRepo.update(station.id, {
        status: 'unknown',
        statusReason: 'Chưa gắn Sensor Node vào trạm',
        waterLevel: 0,
        humidity: 0,
        vibration: 0,
        change: 0,
      }).catch(() => {});
    }

    return station;
  }

  async createStation(dto: CreateStationDto): Promise<Station> {
    const { damId, stationId: requestedId, stationCode: requestedCode, ...rest } = dto;
    const dam = await this.resolveDamRef(damId);

    const existing = await this.stationRepo.findOne({
      where: { name: dto.name, damRefId: dam.id },
    });
    if (existing) {
      throw new ConflictException(`Trạm quan trắc "${dto.name}" đã tồn tại trên đập này!`);
    }

    let stationId = requestedId ? requestedId.trim() : '';
    if (!stationId) {
      stationId = await this.nextStationId(dam);
    } else {
      validateDeviceId('STATION', stationId);
      const dup = await this.stationRepo.findOne({ where: { stationId } });
      if (dup) {
        throw new ConflictException(`Mã trạm "${stationId}" đã tồn tại trên hệ thống!`);
      }
    }

    const station = this.stationRepo.create({
      ...rest,
      stationId,
      stationCode: requestedCode?.trim() || (await this.nextStationCode()),
      damRefId: dam.id,
      status: 'unknown',
    });
    const saved = await this.stationRepo.save(station);

    // Đăng ký ngay Station -> Dam và kích hoạt đánh giá trạng thái an toàn
    this.sensorService.registerStationDam(saved.stationId, dam.damId);
    await this.sensorService.recomputeStationStatus(saved.stationId);

    await this.auditLogService.logAction({
      action: 'CREATE_STATION',
      category: 'STATION',
      description: `Tạo mới Trạm quan trắc "${saved.name}" thuộc Đập "${dam.name}"`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    return await this.findStationById(saved.stationId);
  }

  async updateStation(stationId: string, dto: UpdateStationDto): Promise<Station> {
    const oldStation = await this.findStationById(stationId);
    const { damId, ...rest } = dto;

    const updateData: Partial<Station> = { ...rest };
    if (damId && damId !== oldStation.damId) {
      updateData.damRefId = (await this.resolveDamRef(damId)).id;
    }

    await this.stationRepo.update({ stationId }, updateData);
    const updatedStation = await this.findStationById(stationId);

    // Nếu Station chuyển sang Dam khác, cập nhật ngay mapping để tổng hợp cấp Dam không bị lệch.
    if (updatedStation.damId && updatedStation.damId !== oldStation.damId) {
      this.sensorService.registerStationDam(updatedStation.stationId, updatedStation.damId);
    }

    await this.auditLogService.logAction({
      action: 'UPDATE_STATION',
      category: 'STATION',
      description: `Cập nhật thông tin Trạm quan trắc "${updatedStation.name}"`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    return updatedStation;
  }

  async deleteStation(stationId: string): Promise<{ ok: boolean }> {
    const station = await this.findStationById(stationId);
    await this.stationRepo.remove(station);
    return { ok: true };
  }
}
