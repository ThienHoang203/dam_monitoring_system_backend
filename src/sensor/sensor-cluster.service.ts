import { Injectable, OnModuleInit, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SensorCluster } from './entities/sensor-cluster.entity';
import { SensorDevice } from './entities/sensor-device.entity';
import { Station } from '../dam/entities/station.entity';
import {
  CreateSensorClusterDto,
  UpdateSensorClusterDto,
  CreateSensorDeviceDto,
  UpdateSensorDeviceDto,
} from './sensor-cluster.dto';

const ONLINE_TIMEOUT_MS = 15 * 1000; // 15 giây không nhận data → offline

// Helper chuyển tiếng Việt có dấu thành slug không dấu dùng trong ID
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
export class SensorClusterService implements OnModuleInit {
  constructor(
    @InjectRepository(SensorCluster)
    private readonly clusterRepo: Repository<SensorCluster>,
    @InjectRepository(SensorDevice)
    private readonly deviceRepo: Repository<SensorDevice>,
    @InjectRepository(Station)
    private readonly stationRepo: Repository<Station>,
  ) { }

  async onModuleInit() {
    // Đợi 1 chút để DamService hoàn tất seed bảng stations nếu DB mới khởi tạo
    setTimeout(() => {
      this.seedDefaultClusters().catch((err) =>
        console.error('[SensorClusterService] Seed clusters error:', err.message),
      );
    }, 1000);
  }

  // ── Seed dữ liệu mẫu ──
  async seedDefaultClusters() {
    const count = await this.clusterRepo.count();
    if (count > 0) return;

    // Tìm danh sách các Trạm (Station) đã tồn tại trong DB
    const stations = await this.stationRepo.find({ take: 3, order: { id: 'ASC' } });
    if (!stations || stations.length === 0) {
      console.warn('[SensorClusterService] Bảng stations trống, chưa thể seed cụm cảm biến.');
      return;
    }

    console.log('[SensorClusterService] Seeding default sensor clusters...');

    const st1 = stations[0].id;
    const st2 = stations[1] ? stations[1].id : st1;
    const st3 = stations[2] ? stations[2].id : st1;

    const clustersData = [
      {
        id: `cluster_${toSlug(stations[0].name)}_k25_500`,
        name: 'Cụm cảm biến K25+500',
        description: 'Cụm cảm biến đặt tại thân đập chính',
        espMacAddress: 'AA:BB:CC:DD:EE:01',
        firmwareVersion: 'v1.0.0',
        installLocation: 'Thân đập chính - K25+500',
        stationId: st1,
      },
      {
        id: `cluster_${toSlug(stations[1]?.name || 'station_2')}_k32_200`,
        name: 'Cụm cảm biến K32+200',
        description: 'Cụm cảm biến đặt tại vai đập phải',
        espMacAddress: 'AA:BB:CC:DD:EE:02',
        firmwareVersion: 'v1.0.0',
        installLocation: 'Vai đập phải - K32+200',
        stationId: st2,
      },
      {
        id: `cluster_${toSlug(stations[2]?.name || 'station_3')}_k18_000`,
        name: 'Cụm cảm biến K18+000',
        description: 'Cụm cảm biến đặt tại chân đập',
        espMacAddress: 'AA:BB:CC:DD:EE:03',
        firmwareVersion: 'v1.0.0',
        installLocation: 'Chân đập - K18+000',
        stationId: st3,
      },
    ];

    const defaultDevices: CreateSensorDeviceDto[] = [
      { sensorType: 'water_level', model: 'HC-SR04', unit: 'cm' },
      { sensorType: 'humidity', model: 'DHT22', unit: '%' },
      { sensorType: 'vibration', model: 'SW-420', unit: 'mm/s' },
    ];

    for (const data of clustersData) {
      const cluster = this.clusterRepo.create(data);
      const saved = await this.clusterRepo.save(cluster);

      for (const deviceDto of defaultDevices) {
        const device = this.deviceRepo.create({
          ...deviceDto,
          clusterId: saved.id,
          status: 'active',
        });
        await this.deviceRepo.save(device);
      }
    }

    console.log('[SensorClusterService] Seeded default clusters successfully!');
  }

  // ── CRUD Cluster ──
  async findAll(stationId?: number, damId?: string): Promise<SensorCluster[]> {
    const qb = this.clusterRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.devices', 'd')
      .leftJoinAndSelect('c.station', 's');

    if (stationId) {
      qb.andWhere('c.stationId = :stationId', { stationId });
    }

    if (damId) {
      qb.andWhere('s.damId = :damId', { damId });
    }

    qb.orderBy('c.createdAt', 'ASC');

    const clusters = await qb.getMany();

    // Tự động cập nhật trạng thái online/offline dựa vào lastSeenAt
    const now = Date.now();
    for (const cluster of clusters) {
      if (cluster.lastSeenAt) {
        const elapsed = now - new Date(cluster.lastSeenAt).getTime();
        const expectedStatus = elapsed > ONLINE_TIMEOUT_MS ? 'offline' : 'online';
        if (cluster.status !== 'error' && cluster.status !== expectedStatus) {
          cluster.status = expectedStatus;
          await this.clusterRepo.update(cluster.id, { status: expectedStatus });
        }
      }
    }

    return clusters;
  }

  async findById(id: string): Promise<SensorCluster> {
    const cluster = await this.clusterRepo.findOne({
      where: { id },
      relations: { devices: true, station: true },
    });
    if (!cluster) throw new NotFoundException(`SensorCluster with id ${id} not found`);
    return cluster;
  }

  async create(dto: CreateSensorClusterDto): Promise<SensorCluster> {
    let clusterId = dto.id ? dto.id.trim() : '';

    // 1. Nếu không truyền id, Backend tự động sinh ID duy nhất ghép từ tên Trạm & Vị trí
    if (!clusterId) {
      const station = await this.stationRepo.findOne({ where: { id: dto.stationId } });
      const stationSlug = station ? toSlug(station.name) : `tram_${dto.stationId}`;
      const locationSlug = dto.installLocation ? toSlug(dto.installLocation) : '';

      let baseId = locationSlug
        ? `cluster_${stationSlug}_${locationSlug}`
        : `cluster_${stationSlug}`;

      if (baseId.length > 55) baseId = baseId.slice(0, 55);

      clusterId = baseId;
      let counter = 1;
      while (await this.clusterRepo.findOne({ where: { id: clusterId } })) {
        clusterId = `${baseId}_${String(counter).padStart(2, '0')}`;
        counter++;
      }
    } else {
      // 2. Nếu có truyền id, kiểm tra trùng lặp để KHÔNG CHO GHI ĐÈ
      const existing = await this.clusterRepo.findOne({ where: { id: clusterId } });
      if (existing) {
        throw new ConflictException(`Mã cụm cảm biến "${clusterId}" đã tồn tại trên hệ thống, không thể ghi đè!`);
      }
    }

    const cluster = this.clusterRepo.create({
      id: clusterId,
      name: dto.name,
      description: dto.description,
      espMacAddress: dto.espMacAddress,
      firmwareVersion: dto.firmwareVersion,
      installLocation: dto.installLocation,
      stationId: dto.stationId,
      status: 'offline',
    });

    const saved = await this.clusterRepo.save(cluster);

    // Tạo các device mặc định nếu không truyền devices
    const devicesToCreate = dto.devices && dto.devices.length > 0
      ? dto.devices
      : [
        { sensorType: 'water_level', model: 'HC-SR04', unit: 'cm' },
        { sensorType: 'humidity', model: 'DHT22', unit: '%' },
        { sensorType: 'vibration', model: 'SW-420', unit: 'mm/s' },
      ];

    for (const deviceDto of devicesToCreate) {
      const device = this.deviceRepo.create({
        ...deviceDto,
        clusterId: saved.id,
        status: 'active',
      });
      await this.deviceRepo.save(device);
    }

    return this.findById(saved.id);
  }

  async update(id: string, dto: UpdateSensorClusterDto): Promise<SensorCluster> {
    await this.findById(id);
    await this.clusterRepo.update(id, dto);
    return this.findById(id);
  }

  async delete(id: string): Promise<{ ok: boolean }> {
    const cluster = await this.findById(id);
    await this.clusterRepo.remove(cluster);
    return { ok: true };
  }

  // ── Online status ──
  async updateOnlineStatus(clusterId: string, lastSeenAt: Date): Promise<void> {
    try {
      await this.clusterRepo.update(clusterId, {
        status: 'online',
        lastSeenAt,
      });
    } catch {
      // Cluster không tồn tại — bỏ qua (backward compatible)
    }
  }

  // ── CRUD Device ──
  async addDevice(clusterId: string, dto: CreateSensorDeviceDto): Promise<SensorDevice> {
    await this.findById(clusterId); // đảm bảo cluster tồn tại
    const device = this.deviceRepo.create({
      ...dto,
      clusterId,
      status: 'active',
    });
    return this.deviceRepo.save(device);
  }

  async updateDevice(deviceId: string, dto: UpdateSensorDeviceDto): Promise<SensorDevice> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException(`SensorDevice with id ${deviceId} not found`);
    await this.deviceRepo.update(deviceId, dto);
    return this.deviceRepo.findOneOrFail({ where: { id: deviceId } });
  }

  async removeDevice(deviceId: string): Promise<{ ok: boolean }> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException(`SensorDevice with id ${deviceId} not found`);
    await this.deviceRepo.remove(device);
    return { ok: true };
  }
}
