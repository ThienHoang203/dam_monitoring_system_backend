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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { EvidenceService } from './evidence.service';
import { SensorGateway } from '../gateway/sensor.gateway';

@Controller('api/evidence')
export class EvidenceController {
  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly sensorGateway: SensorGateway,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /api/evidence/upload
   * Multipart form data from Jetson TX2:
   *   - file: image/jpeg
   *   - gateway_id: string
   *   - event_id?: string
   *   - node_id?: string
   *   - confidence: string (parsed to float)
   *   - threshold_val?: string (parsed to float)
   *   - measured_val?: string (parsed to float)
   *   - timestamp: ISO string
   */
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
      // Rewrite MinIO URL to backend proxy URL (/sensor/images/...) for Frontend
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
  async findAll(
    @Query('gatewayId') gatewayId?: string,
    @Query('limit') limit?: string,
  ) {
    const maxLimit = limit ? parseInt(limit, 10) : 50;
    const evidences = await this.evidenceService.findAll(gatewayId, maxLimit);
    return { evidences };
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const evidence = await this.evidenceService.findById(id);
    return { evidence };
  }
}
