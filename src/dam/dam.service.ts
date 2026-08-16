import { Injectable, OnModuleInit, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dam } from './entities/dam.entity';
import { Station } from './entities/station.entity';
import { CreateDamDto, UpdateDamDto, CreateStationDto, UpdateStationDto } from './dam.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

import { Gateway } from '../gateway/entities/gateway.entity';
import { Camera } from '../camera/entities/camera.entity';
import { Node } from '../node/entities/node.entity';
import { Sensor } from '../node/entities/sensor.entity';
import { SensorService } from '../sensor/sensor.service';

// Helper chuyển tiếng Việt thành slug không dấu
function toSlug(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

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

  async seedDefaultData() {
    const count = await this.damRepo.count();
    if (count > 0) {
      await this.seedDefaultDevices();
      return;
    }

    console.log('[DamService] Seeding default Dam and Station data...');

    const damsData = [
      { id: 'dam_1', name: 'Đập Thủy điện Hòa Bình', location: 'Hòa Bình', latitude: 20.8167, longitude: 105.3265, status: 'safe', waterLevel: 105.2, flow: 1200, fillPct: 78 },
      { id: 'dam_2', name: 'Đập Sơn La', location: 'Sơn La', latitude: 21.5622, longitude: 103.9781, status: 'warning', waterLevel: 212.5, flow: 3450, fillPct: 88 },
      { id: 'dam_3', name: 'Đập Lai Châu', location: 'Lai Châu', latitude: 22.1464, longitude: 103.0189, status: 'safe', waterLevel: 295.1, flow: 850, fillPct: 65 },
      { id: 'dam_4', name: 'Đập Tuyên Quang', location: 'Tuyên Quang', latitude: 22.3556, longitude: 105.3853, status: 'safe', waterLevel: 118.3, flow: 620, fillPct: 72 },
    ];

    for (const d of damsData) {
      const dam = this.damRepo.create(d);
      await this.damRepo.save(dam);
    }

    const stationsData = [
      { id: 1, stationCode: 'ST01', name: 'Trạm Tân Ấp 1', location: 'Hoàn Kiếm, Hà Nội', latitude: 21.0381, longitude: 105.8492, river: 'Sông Hồng', km: 'K25+500', status: 'danger', waterLevel: 12.5, change: 0.4, pressure: 450, flow: 3200, humidity: 78, bd3: 12.0, bd2: 10.5, bd1: 9.0, damId: 'dam_1' },
      { id: 2, stationCode: 'ST02', name: 'Trạm Nhật Tân', location: 'Tây Hồ, Hà Nội', latitude: 21.0825, longitude: 105.8194, river: 'Sông Hồng', km: 'K32+200', status: 'warning', waterLevel: 9.8, change: 0.1, pressure: 280, flow: 2100, humidity: 62, bd3: 11.0, bd2: 9.5, bd1: 8.5, damId: 'dam_1' },
      { id: 3, stationCode: 'ST03', name: 'Trạm Long Biên', location: 'Long Biên, Hà Nội', latitude: 21.0428, longitude: 105.8617, river: 'Sông Hồng', km: 'K18+000', status: 'safe', waterLevel: 6.2, change: -0.2, pressure: 120, flow: 1400, humidity: 45, bd3: 10.0, bd2: 8.5, bd1: 7.5, damId: 'dam_1' },
      { id: 4, stationCode: 'ST04', name: 'Trạm Sơn Tây', location: 'Sơn Tây, Hà Nội', latitude: 21.1415, longitude: 105.5034, river: 'Sông Đà', km: 'K45+000', status: 'warning', waterLevel: 8.1, change: 0.5, pressure: 310, flow: 2450, humidity: 58, bd3: 9.5, bd2: 8.0, bd1: 7.0, damId: 'dam_2' },
      { id: 5, stationCode: 'ST05', name: 'Trạm Hà Nội', location: 'Hoàn Kiếm, Hà Nội', latitude: 21.0285, longitude: 105.8542, river: 'Sông Hồng', km: 'K120+000', status: 'warning', waterLevel: 6.12, change: 0.05, pressure: 200, flow: 1800, humidity: 52, bd3: 8.5, bd2: 7.0, bd1: 6.0, damId: 'dam_1' },
      { id: 6, stationCode: 'ST06', name: 'Trạm Hưng Yên', location: 'Hưng Yên', latitude: 20.6464, longitude: 106.0511, river: 'Sông Hồng', km: 'TR-HY-01', status: 'danger', waterLevel: 7.45, change: 0.3, pressure: 380, flow: 2800, humidity: 71, bd3: 7.0, bd2: 6.5, bd1: 5.5, damId: 'dam_1' },
      { name: 'Trạm Quan Trắc K25+500 (Thân Đập)', damId: 'dam_1', latitude: 20.8170, longitude: 105.3270, location: 'K25+500', river: 'Sông Đà', km: 'KM 25' },
      { name: 'Trạm Quan Trắc Cống Xả Lũ Số 1', damId: 'dam_1', latitude: 20.8155, longitude: 105.3250, location: 'Cống xả lũ', river: 'Sông Đà', km: 'KM 26' },
      { name: 'Trạm Quan Trắc Thân Đập Chính Sơn La', damId: 'dam_2', latitude: 21.3290, longitude: 103.9050, location: 'Mặt đập chính', river: 'Sông Đà', km: 'KM 110' },
    ];

    for (const st of stationsData) {
      await this.stationRepo.save(this.stationRepo.create(st));
    }

    await this.seedDefaultDevices();
  }

  async seedDefaultDevices() {
    const gwCount = await this.gatewayRepo.count();
    if (gwCount > 0) return;

    console.log('[DamService] Seeding default IoT physical devices (Gateway, Camera, Node, Sensors)...');

    // 1. Gateway GTW-ST01-TX2A for Station 1
    const gw = this.gatewayRepo.create({
      id: 'GTW-ST01-TX2A',
      name: 'Gateway Jetson TX2 - Trạm 01',
      macAddress: 'AA:BB:CC:DD:EE:01',
      firmwareVersion: 'v2.1.0',
      description: 'Gateway AI Jetson TX2 tại Trạm Tân Ấp 1',
      stationId: 1,
      status: 'offline',
    });
    await this.gatewayRepo.save(gw);

    // 2. Camera CAM-CSI-ST01-01 for GTW-ST01-TX2A
    const cam = this.cameraRepo.create({
      id: 'CAM-CSI-ST01-01',
      cameraType: 'CSI',
      name: 'Camera CSI - Jetson TX2 Trạm 01',
      resolution: '1280x720',
      gatewayId: 'GTW-ST01-TX2A',
      status: 'active',
    });
    await this.cameraRepo.save(cam);

    // 3. Node NOD-ST01-ESP01 for GTW-ST01-TX2A, mapped to CAM-CSI-ST01-01
    const node = this.nodeRepo.create({
      id: 'NOD-ST01-ESP01',
      name: 'Node ESP32 #01 - K25+500',
      macAddress: 'AA:BB:CC:DD:EE:02',
      firmwareVersion: 'v1.0.0',
      installLocation: 'Thân đập chính - K25+500',
      vibrationThreshold: 15.0,
      gatewayId: 'GTW-ST01-TX2A',
      mappedCameraId: 'CAM-CSI-ST01-01',
      status: 'offline',
    });
    await this.nodeRepo.save(node);

    // 4. Sensors for NOD-ST01-ESP01
    const sensors = [
      { id: 'SNR-VIB-ESP01-I2C1', sensorType: 'VIB', model: 'MPU6050', unit: 'mm/s', nodeId: 'NOD-ST01-ESP01' },
      { id: 'SNR-WTL-ESP01-ADC1', sensorType: 'WTL', model: 'HC-SR04', unit: 'cm', nodeId: 'NOD-ST01-ESP01' },
      { id: 'SNR-MST-ESP01-ADC2', sensorType: 'MST', model: 'Capacitive v1.2', unit: '%', nodeId: 'NOD-ST01-ESP01' },
    ];

    for (const s of sensors) {
      await this.sensorRepo.save(this.sensorRepo.create(s));
    }

    console.log('[DamService] IoT devices seeded successfully!');
  }

  async findAllDams(): Promise<Dam[]> {
    return this.damRepo.find({ relations: { stations: true } });
  }

  async findDamById(id: string): Promise<Dam> {
    const dam = await this.damRepo.findOne({ where: { id }, relations: { stations: true } });
    if (!dam) throw new NotFoundException(`Dam with id ${id} not found`);
    return dam;
  }

  async createDam(dto: CreateDamDto): Promise<Dam> {
    let damId = dto.id ? dto.id.trim() : '';

    if (!damId) {
      const nameSlug = toSlug(dto.name);
      let baseId = nameSlug ? `dam_${nameSlug}` : `dam_${Date.now().toString().slice(-6)}`;
      if (baseId.length > 55) baseId = baseId.slice(0, 55);

      damId = baseId;
      let counter = 1;
      while (await this.damRepo.findOne({ where: { id: damId } })) {
        damId = `${baseId}_${String(counter).padStart(2, '0')}`;
        counter++;
      }
    } else {
      const existing = await this.damRepo.findOne({ where: { id: damId } });
      if (existing) {
        throw new ConflictException(`Mã đập thủy điện "${damId}" đã tồn tại trên hệ thống, không thể ghi đè!`);
      }
    }

    const dam = this.damRepo.create({
      ...dto,
      id: damId,
      status: 'unknown',
    });
    const saved = await this.damRepo.save(dam);

    // Đập mới phải có ngay bộ ngưỡng mặc định, nếu không sẽ không cảnh báo được
    // nước/độ ẩm và form sửa ngưỡng sẽ lưu không ăn (không có bản ghi để update).
    await this.sensorService.ensureThresholdConfigs(saved.id);
    await this.sensorService.recomputeDamStatus(saved.id);

    await this.auditLogService.logAction({
      action: 'CREATE_DAM',
      category: 'DAM',
      description: `Tạo mới Đập Thủy Điện "${saved.name}" (Mã: ${saved.id}, Vị trí: ${saved.location || 'Chưa rõ'})`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    return await this.findDamById(saved.id);
  }

  async updateDam(id: string, dto: UpdateDamDto): Promise<Dam> {
    const oldDam = await this.findDamById(id);
    await this.damRepo.update(id, dto);
    const updatedDam = await this.findDamById(id);

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

  async deleteDam(id: string): Promise<{ ok: boolean }> {
    const dam = await this.findDamById(id);
    await this.damRepo.remove(dam);
    // ThresholdConfig không có khoá ngoại tới Dam nên phải dọn tay, tránh để lại bản ghi mồ côi.
    await this.sensorService.deleteThresholdConfigsByDam(id);

    await this.auditLogService.logAction({
      action: 'DELETE_DAM',
      category: 'DAM',
      description: `Xóa Đập Thủy Điện "${dam.name}" (Mã: ${dam.id})`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    return { ok: true };
  }

  // ── Station CRUD ──
  async findAllStations(damId?: string): Promise<Station[]> {
    if (damId) {
      return this.stationRepo.find({
        where: { damId },
        relations: { dam: true, gateways: { nodes: { sensors: true }, cameras: true } },
      });
    }
    return this.stationRepo.find({
      relations: { dam: true, gateways: { nodes: { sensors: true }, cameras: true } },
    });
  }

  async findStationById(id: number): Promise<Station> {
    const station = await this.stationRepo.findOne({
      where: { id },
      relations: { dam: true, gateways: { nodes: { sensors: true }, cameras: true } },
    });
    if (!station) throw new NotFoundException(`Station with id ${id} not found`);
    return station;
  }

  async createStation(dto: CreateStationDto): Promise<Station> {
    const dam = await this.findDamById(dto.damId);

    const existing = await this.stationRepo.findOne({
      where: { name: dto.name, damId: dto.damId },
    });
    if (existing) {
      throw new ConflictException(`Trạm quan trắc "${dto.name}" đã tồn tại trên đập này!`);
    }

    const station = this.stationRepo.create({
      ...dto,
      status: 'unknown',
    });
    const saved = await this.stationRepo.save(station);

    // Đăng ký ngay Station -> Dam và kích hoạt đánh giá trạng thái an toàn
    this.sensorService.registerStationDam(saved.id, saved.damId);
    await this.sensorService.recomputeStationStatus(saved.id);

    await this.auditLogService.logAction({
      action: 'CREATE_STATION',
      category: 'STATION',
      description: `Tạo mới Trạm quan trắc "${saved.name}" thuộc Đập "${dam.name}"`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    return await this.findStationById(saved.id);
  }

  async updateStation(id: number, dto: UpdateStationDto): Promise<Station> {
    const oldStation = await this.findStationById(id);
    await this.stationRepo.update(id, dto);
    const updatedStation = await this.findStationById(id);

    // Nếu Station chuyển sang Dam khác, cập nhật ngay mapping để tổng hợp cấp Dam không bị lệch.
    if (updatedStation.damId && updatedStation.damId !== oldStation.damId) {
      this.sensorService.registerStationDam(updatedStation.id, updatedStation.damId);
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

  async deleteStation(id: number): Promise<{ ok: boolean }> {
    const station = await this.findStationById(id);
    await this.stationRepo.remove(station);
    return { ok: true };
  }
}
