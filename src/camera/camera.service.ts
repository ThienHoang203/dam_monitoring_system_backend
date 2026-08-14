import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Camera } from './entities/camera.entity';
import { CreateCameraDto, UpdateCameraDto } from './camera.dto';
import {
  validateDeviceId,
  validateCameraType,
} from '../common/validators/naming-convention.validator';

@Injectable()
export class CameraService {
  constructor(
    @InjectRepository(Camera)
    private readonly cameraRepo: Repository<Camera>,
  ) {}

  async findAll(gatewayId?: string): Promise<Camera[]> {
    const where: any = {};
    if (gatewayId) where.gatewayId = gatewayId;
    return this.cameraRepo.find({ where, order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<Camera> {
    const camera = await this.cameraRepo.findOne({ where: { id } });
    if (!camera) throw new NotFoundException(`Camera "${id}" không tồn tại.`);
    return camera;
  }

  async create(dto: CreateCameraDto): Promise<Camera> {
    // Validate naming convention
    validateDeviceId('CAMERA', dto.id);
    validateCameraType(dto.cameraType);

    // Enforce: IP camera requires stream_url
    if (dto.cameraType === 'IP' && !dto.streamUrl) {
      throw new BadRequestException(
        'Camera loại IP bắt buộc phải có streamUrl (RTSP URL).',
      );
    }

    // Check duplicate
    const existing = await this.cameraRepo.findOne({ where: { id: dto.id } });
    if (existing) {
      throw new ConflictException(
        `Camera "${dto.id}" đã tồn tại trên hệ thống.`,
      );
    }

    const camera = this.cameraRepo.create(dto);
    return this.cameraRepo.save(camera);
  }

  async update(id: string, dto: UpdateCameraDto): Promise<Camera> {
    await this.findById(id);
    await this.cameraRepo.update(id, dto);
    return this.findById(id);
  }

  async delete(id: string): Promise<{ ok: boolean }> {
    const camera = await this.findById(id);
    await this.cameraRepo.remove(camera);
    return { ok: true };
  }
}
