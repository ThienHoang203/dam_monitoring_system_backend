import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Camera } from './entities/camera.entity';
import { CreateCameraDto, UpdateCameraDto } from './camera.dto';
import {
  validateDeviceId,
  validateCameraType,
} from '../common/validators/naming-convention.validator';
import { GatewayService } from '../gateway/gateway.service';

@Injectable()
export class CameraService {
  constructor(
    @InjectRepository(Camera)
    private readonly cameraRepo: Repository<Camera>,
    @Inject(forwardRef(() => GatewayService))
    private readonly gatewayService: GatewayService,
  ) {}

  async findAll(gatewayId?: string): Promise<Camera[]> {
    return this.cameraRepo.find({
      where: gatewayId ? { gateway: { gatewayId } } : {},
      relations: { gateway: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findById(cameraId: string): Promise<Camera> {
    const camera = await this.cameraRepo.findOne({
      where: { cameraId },
      relations: { gateway: true },
    });
    if (!camera) throw new NotFoundException(`Camera "${cameraId}" không tồn tại.`);
    return camera;
  }

  /**
   * Sinh mã camera CAM-[CAM_TYPE]-[STATION_CODE]-[SEQ_ID] theo chuẩn A.3.2.
   * SEQ_ID đánh số trong phạm vi STATION_CODE (mã đã mang sẵn trạm, không phải gateway).
   */
  private async nextCameraId(stationCode: string, cameraType: string): Promise<string> {
    const prefix = `CAM-${cameraType}-${stationCode}-`;
    const siblings = await this.cameraRepo.find({ select: { cameraId: true } });
    let max = 0;
    for (const c of siblings) {
      if (!c.cameraId?.startsWith(prefix)) continue;
      const seq = parseInt(c.cameraId.slice(prefix.length), 10);
      if (!isNaN(seq)) max = Math.max(max, seq);
    }
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  }

  async create(dto: CreateCameraDto): Promise<Camera> {
    validateCameraType(dto.cameraType);

    // Enforce: IP camera requires stream_url
    if (dto.cameraType === 'IP' && !dto.streamUrl) {
      throw new BadRequestException(
        'Camera loại IP bắt buộc phải có streamUrl (RTSP URL).',
      );
    }

    const { gatewayId, cameraId: requestedId, ...rest } = dto;
    const gateway = await this.gatewayService.findById(gatewayId);

    const stationCode =
      gateway.station?.stationCode || `ST${String(gateway.stationRefId).padStart(2, '0')}`;
    const cameraId =
      requestedId?.trim() || (await this.nextCameraId(stationCode, dto.cameraType));
    validateDeviceId('CAMERA', cameraId);

    const existing = await this.cameraRepo.findOne({ where: { cameraId } });
    if (existing) {
      throw new ConflictException(
        `Camera "${cameraId}" đã tồn tại trên hệ thống.`,
      );
    }

    const camera = this.cameraRepo.create({
      ...rest,
      cameraId,
      gatewayRefId: gateway.id,
    });
    await this.cameraRepo.save(camera);
    const saved = await this.findById(cameraId);
    this.gatewayService.publishGatewayConfig(gatewayId).catch(() => {});
    return saved;
  }

  async update(cameraId: string, dto: UpdateCameraDto): Promise<Camera> {
    const existing = await this.findById(cameraId);

    // Enforce: IP camera requires stream_url (either already set or provided now)
    const effectiveStreamUrl = dto.streamUrl !== undefined ? dto.streamUrl : existing.streamUrl;
    if (existing.cameraType === 'IP' && !effectiveStreamUrl) {
      throw new BadRequestException(
        'Camera loại IP bắt buộc phải có streamUrl (RTSP URL).',
      );
    }

    const { gatewayId, ...rest } = dto;
    const updateData: Partial<Camera> = { ...rest };
    if (gatewayId && gatewayId !== existing.gatewayId) {
      updateData.gatewayRefId = (await this.gatewayService.findById(gatewayId)).id;
    }

    await this.cameraRepo.update({ cameraId }, updateData);
    const updated = await this.findById(cameraId);

    // Camera đổi gateway -> cả gateway cũ lẫn mới đều phải nhận lại config.
    for (const gw of new Set([existing.gatewayId, updated.gatewayId].filter(Boolean))) {
      this.gatewayService.publishGatewayConfig(gw as string).catch(() => {});
    }
    return updated;
  }

  async delete(cameraId: string): Promise<{ ok: boolean }> {
    const camera = await this.findById(cameraId);
    const gatewayId = camera.gatewayId;
    await this.cameraRepo.remove(camera);
    if (gatewayId) {
      this.gatewayService.publishGatewayConfig(gatewayId).catch(() => {});
    }
    return { ok: true };
  }
}
