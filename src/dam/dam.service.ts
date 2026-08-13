import { Injectable, OnModuleInit, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dam } from './entities/dam.entity';
import { Station } from './entities/station.entity';
import { CreateDamDto, UpdateDamDto, CreateStationDto, UpdateStationDto } from './dam.dto';

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
  ) {}

  async onModuleInit() {
    await this.seedDefaultData();
  }

  async seedDefaultData() {
    const count = await this.damRepo.count();
    if (count > 0) return;

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
      { id: 1, name: 'Trạm Tân Ấp 1', location: 'Hoàn Kiếm, Hà Nội', latitude: 21.0381, longitude: 105.8492, river: 'Sông Hồng', km: 'K25+500', status: 'danger', waterLevel: 12.5, change: 0.4, pressure: 450, flow: 3200, humidity: 78, bd3: 12.0, bd2: 10.5, bd1: 9.0, damId: 'dam_1' },
      { id: 2, name: 'Trạm Nhật Tân', location: 'Tây Hồ, Hà Nội', latitude: 21.0825, longitude: 105.8194, river: 'Sông Hồng', km: 'K32+200', status: 'warning', waterLevel: 9.8, change: 0.1, pressure: 280, flow: 2100, humidity: 62, bd3: 11.0, bd2: 9.5, bd1: 8.5, damId: 'dam_1' },
      { id: 3, name: 'Trạm Long Biên', location: 'Long Biên, Hà Nội', latitude: 21.0428, longitude: 105.8617, river: 'Sông Hồng', km: 'K18+000', status: 'safe', waterLevel: 6.2, change: -0.2, pressure: 120, flow: 1400, humidity: 45, bd3: 10.0, bd2: 8.5, bd1: 7.5, damId: 'dam_1' },
      { id: 4, name: 'Trạm Sơn Tây', location: 'Sơn Tây, Hà Nội', latitude: 21.1415, longitude: 105.5034, river: 'Sông Đà', km: 'K45+000', status: 'warning', waterLevel: 8.1, change: 0.5, pressure: 310, flow: 2450, humidity: 58, bd3: 9.5, bd2: 8.0, bd1: 7.0, damId: 'dam_2' },
      { id: 5, name: 'Trạm Hà Nội', location: 'Hoàn Kiếm, Hà Nội', latitude: 21.0285, longitude: 105.8542, river: 'Sông Hồng', km: 'K120+000', status: 'warning', waterLevel: 6.12, change: 0.05, pressure: 200, flow: 1800, humidity: 52, bd3: 8.5, bd2: 7.0, bd1: 6.0, damId: 'dam_1' },
      { id: 6, name: 'Trạm Hưng Yên', location: 'Hưng Yên', latitude: 20.6464, longitude: 106.0511, river: 'Sông Hồng', km: 'TR-HY-01', status: 'danger', waterLevel: 7.45, change: 0.3, pressure: 380, flow: 2800, humidity: 71, bd3: 7.0, bd2: 6.5, bd1: 5.5, damId: 'dam_1' },
      { id: 7, name: 'Trạm Nam Định', location: 'Nam Định', latitude: 20.4200, longitude: 106.1683, river: 'Sông Đào', km: 'TR-ND-05', status: 'warning', waterLevel: 4.2, change: 0.1, pressure: 180, flow: 1200, humidity: 48, bd3: 5.0, bd2: 4.0, bd1: 3.5, damId: 'dam_3' },
      { id: 8, name: 'Trạm Phủ Lý', location: 'Phủ Lý, Hà Nam', latitude: 20.5453, longitude: 105.9128, river: 'Sông Đáy', km: 'TR-PL-02', status: 'safe', waterLevel: 3.8, change: 0, pressure: 95, flow: 800, humidity: 40, bd3: 6.5, bd2: 5.5, bd1: 4.5, damId: 'dam_4' },
    ];

    for (const s of stationsData) {
      const station = this.stationRepo.create(s);
      await this.stationRepo.save(station);
    }

    console.log('[DamService] Seeded default data successfully!');
  }

  // ── Dam CRUD ──
  async findAllDams(): Promise<Dam[]> {
    return this.damRepo.find({ relations: { stations: { sensorClusters: true } } });
  }

  async findDamById(id: string): Promise<Dam> {
    const dam = await this.damRepo.findOne({ where: { id }, relations: { stations: { sensorClusters: true } } });
    if (!dam) throw new NotFoundException(`Dam with id ${id} not found`);
    return dam;
  }

  async createDam(dto: CreateDamDto): Promise<Dam> {
    let damId = dto.id ? dto.id.trim() : '';

    // 1. Nếu không truyền id, tự động tạo id dạng dam_name_slug
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
      // 2. Nếu có truyền id, kiểm tra trùng lặp để KHÔNG GHI ĐÈ
      const existing = await this.damRepo.findOne({ where: { id: damId } });
      if (existing) {
        throw new ConflictException(`Mã đập thủy điện "${damId}" đã tồn tại trên hệ thống, không thể ghi đè!`);
      }
    }

    const dam = this.damRepo.create({
      ...dto,
      id: damId,
    });
    return this.damRepo.save(dam);
  }

  async updateDam(id: string, dto: UpdateDamDto): Promise<Dam> {
    await this.findDamById(id);
    await this.damRepo.update(id, dto);
    return this.findDamById(id);
  }

  async deleteDam(id: string): Promise<{ ok: boolean }> {
    const dam = await this.findDamById(id);
    await this.damRepo.remove(dam);
    return { ok: true };
  }

  // ── Station CRUD ──
  async findAllStations(damId?: string): Promise<Station[]> {
    if (damId) {
      return this.stationRepo.find({ where: { damId }, relations: { dam: true, sensorClusters: true } });
    }
    return this.stationRepo.find({ relations: { dam: true, sensorClusters: true } });
  }

  async findStationById(id: number): Promise<Station> {
    const station = await this.stationRepo.findOne({ where: { id }, relations: { dam: true, sensorClusters: true } });
    if (!station) throw new NotFoundException(`Station with id ${id} not found`);
    return station;
  }

  async createStation(dto: CreateStationDto): Promise<Station> {
    // 1. Kiểm tra Đập thủy điện có tồn tại không
    await this.findDamById(dto.damId);

    // 2. Kiểm tra tên Trạm trùng lặp trên cùng 1 Đập
    const existing = await this.stationRepo.findOne({
      where: { name: dto.name, damId: dto.damId },
    });
    if (existing) {
      throw new ConflictException(`Trạm quan trắc "${dto.name}" đã tồn tại trên đập này!`);
    }

    const station = this.stationRepo.create(dto);
    return this.stationRepo.save(station);
  }

  async updateStation(id: number, dto: UpdateStationDto): Promise<Station> {
    await this.findStationById(id);
    await this.stationRepo.update(id, dto);
    return this.findStationById(id);
  }

  async deleteStation(id: number): Promise<{ ok: boolean }> {
    const station = await this.findStationById(id);
    await this.stationRepo.remove(station);
    return { ok: true };
  }
}
