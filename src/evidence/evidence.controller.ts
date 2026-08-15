import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { EvidenceService } from './evidence.service';
import { SensorGateway } from '../gateway/sensor.gateway';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { GatewayApiKeyGuard } from '../auth/guards/gateway-api-key.guard';

@Controller('api/evidence')
export class EvidenceController {
  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly sensorGateway: SensorGateway,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /api/evidence/upload
   * Multipart form data từ Jetson TX2 / Edge Node
   */
  @Public()
  @UseGuards(GatewayApiKeyGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile()
    file: { originalname: string; mimetype?: string; buffer: Buffer },
    @Body('gateway_id') gatewayId: string,
    @Body('event_id') eventId?: string,
    @Body('node_id') nodeId?: string,
    @Body('confidence') confidence?: string,
    @Body('threshold_val') thresholdVal?: string,
    @Body('measured_val') measuredVal?: string,
    @Body('timestamp') timestamp?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Thiếu file ảnh evidence.');
    }

    // Giới hạn kích thước file (tối đa 10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.buffer && file.buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException('Dung lượng file tải lên vượt quá giới hạn 10MB.');
    }

    // Kiểm tra định dạng MIME (Chỉ chấp nhận file ảnh)
    if (file.mimetype && !file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Định dạng file không hợp lệ. Chỉ chấp nhận file hình ảnh.');
    }

    if (!gatewayId) {
      throw new BadRequestException('Thiếu gateway_id.');
    }

    const { evidence, updatedAlarm } =
      await this.evidenceService.uploadEvidence(
        file,
        gatewayId,
        confidence ? parseFloat(confidence) : 0,
        timestamp || new Date().toISOString(),
        eventId,
        nodeId,
        thresholdVal ? parseFloat(thresholdVal) : undefined,
        measuredVal ? parseFloat(measuredVal) : undefined,
      );

    if (updatedAlarm) {
      let proxyImageUrl = updatedAlarm.imageUrl;
      if (proxyImageUrl && proxyImageUrl.includes('/dam-images/')) {
        const parts = proxyImageUrl.split('/dam-images/');
        proxyImageUrl = `/sensor/images/${parts[1]}`;
      }

      this.sensorGateway.broadcastAlarm({
        ...updatedAlarm,
        imageUrl: proxyImageUrl,
      });
    }

    return { ok: true, evidence, alarm: updatedAlarm };
  }

  @Get()
  @Roles('ADMIN', 'OPERATOR')
  async findAll(
    @Query('gatewayId') gatewayId?: string,
    @Query('limit') limit?: string,
  ) {
    const maxLimit = limit ? parseInt(limit, 10) : 50;
    const evidences = await this.evidenceService.findAll(gatewayId, maxLimit);
    return { evidences };
  }

  @Get(':id')
  @Roles('ADMIN', 'OPERATOR')
  async findById(@Param('id') id: string) {
    const evidence = await this.evidenceService.findById(id);
    return { evidence };
  }
}
