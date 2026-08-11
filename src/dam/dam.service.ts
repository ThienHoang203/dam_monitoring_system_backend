import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dam } from './entities/dam.entity';
import { Station } from './entities/station.entity';
import { CreateDamDto, UpdateDamDto, CreateStationDto, UpdateStationDto } from './dam.dto';

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
      { id: 'dam_1', name: 'Đập Thủy điện Hòa Bình', location: 'Hòa Bình', status: 'safe', waterLevel: 105.2, flow: 1200, fillPct: 78 },
      { id: 'dam_2', name: 'Đập Sơn La', location: 'Sơn La', status: 'warning', waterLevel: 212.5, flow: 3450, fillPct: 88 },
      { id: 'dam_3', name: 'Đập Lai Châu', location: 'Lai Châu', status: 'safe', waterLevel: 295.1, flow: 850, fillPct: 65 },
      { id: 'dam_4', name: 'Đập Tuyên Quang', location: 'Tuyên Quang', status: 'safe', waterLevel: 118.3, flow: 620, fillPct: 72 },
    ];

    for (const d of damsData) {
      const dam = this.damRepo.create(d);
      await this.damRepo.save(dam);
    }

    const stationsData = [
      { id: 1, name: 'Trạm Tân Ấp 1', location: 'Hoàn Kiếm, Hà Nội', river: 'Sông Hồng', km: 'K25+500', status: 'danger', waterLevel: 12.5, change: 0.4, pressure: 450, flow: 3200, humidity: 78, bd3: 12.0, bd2: 10.5, bd1: 9.0, damId: 'dam_1' },
      { id: 2, name: 'Trạm Nhật Tân', location: 'Tây Hồ, Hà Nội', river: 'Sông Hồng', km: 'K32+200', status: 'warning', waterLevel: 9.8, change: 0.1, pressure: 280, flow: 2100, humidity: 62, bd3: 11.0, bd2: 9.5, bd1: 8.5, damId: 'dam_1' },
      { id: 3, name: 'Trạm Long Biên', location: 'Long Biên, Hà Nội', river: 'Sông Hồng', km: 'K18+000', status: 'safe', waterLevel: 6.2, change: -0.2, pressure: 120, flow: 1400, humidity: 45, bd3: 10.0, bd2: 8.5, bd1: 7.5, damId: 'dam_1' },
      { id: 4, name: 'Trạm Sơn Tây', location: 'Sơn Tây, Hà Nội', river: 'Sông Đà', km: 'K45+000', status: 'warning', waterLevel: 8.1, change: 0.5, pressure: 310, flow: 2450, humidity: 58, bd3: 9.5, bd2: 8.0, bd1: 7.0, damId: 'dam_2' },
      { id: 5, name: 'Trạm Hà Nội', location: 'Hoàn Kiếm, Hà Nội', river: 'Sông Hồng', km: 'K120+000', status: 'warning', waterLevel: 6.12, change: 0.05, pressure: 200, flow: 1800, humidity: 52, bd3: 8.5, bd2: 7.0, bd1: 6.0, damId: 'dam_1' },
      { id: 6, name: 'Trạm Hưng Yên', location: 'Hưng Yên', river: 'Sông Hồng', km: 'TR-HY-01', status: 'danger', waterLevel: 7.45, change: 0.3, pressure: 380, flow: 2800, humidity: 71, bd3: 7.0, bd2: 6.5, bd1: 5.5, damId: 'dam_1' },
      { id: 7, name: 'Trạm Nam Định', location: 'Nam Định', river: 'Sông Đào', km: 'TR-ND-05', status: 'warning', waterLevel: 4.2, change: 0.1, pressure: 180, flow: 1200, humidity: 48, bd3: 5.0, bd2: 4.0, bd1: 3.5, damId: 'dam_3' },
      { id: 8, name: 'Trạm Phủ Lý', location: 'Phủ Lý, Hà Nam', river: 'Sông Đáy', km: 'TR-PL-02', status: 'safe', waterLevel: 3.8, change: 0, pressure: 95, flow: 800, humidity: 40, bd3: 6.5, bd2: 5.5, bd1: 4.5, damId: 'dam_4' },
    ];

    for (const s of stationsData) {
      const station = this.stationRepo.create(s);
      await this.stationRepo.save(station);
    }

    console.log('[DamService] Seeded default data successfully!');
  }

  // ── Dam CRUD ──
  async findAllDams(): Promise<Dam[]> {
    return this.damRepo.find({ relations: { stations: true } });
  }

  async findDamById(id: string): Promise<Dam> {
    const dam = await this.damRepo.findOne({ where: { id }, relations: { stations: true } });
    if (!dam) throw new NotFoundException(`Dam with id ${id} not found`);
    return dam;
  }

  async createDam(dto: CreateDamDto): Promise<Dam> {
    const dam = this.damRepo.create(dto);
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
      return this.stationRepo.find({ where: { damId }, relations: { dam: true } });
    }
    return this.stationRepo.find({ relations: { dam: true } });
  }

  async findStationById(id: number): Promise<Station> {
    const station = await this.stationRepo.findOne({ where: { id }, relations: { dam: true } });
    if (!station) throw new NotFoundException(`Station with id ${id} not found`);
    return station;
  }

  async createStation(dto: CreateStationDto): Promise<Station> {
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
