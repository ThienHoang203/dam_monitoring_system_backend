import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { SensorService } from './sensor.service';
import { SensorDataDto } from './sensor.dto';
import { SensorGateway } from '../gateway/sensor.gateway';

@Controller('sensor')
export class SensorController {
  constructor(
    private readonly sensorService: SensorService,
    private readonly gateway: SensorGateway,
  ) {}

  @Post('all')
  @HttpCode(200)
  async ingest(@Body() dto: SensorDataDto) {
    if (
      dto.freq == null ||
      dto.amp == null ||
      dto.waterLevel == null ||
      dto.moisture == null
    ) {
      throw new BadRequestException('Missing required sensor fields');
    }

    const snapshot = await this.sensorService.ingest(dto);
    this.gateway.broadcastUpdate(snapshot);
    return { ok: true };
  }

  @Get('latest')
  getLatest() {
    return {
      data: this.sensorService.getLatest(),
      history: this.sensorService.getHistory(),
    };
  }

  // Lấy lịch sử thô từ TimescaleDB cho một loại cảm biến cụ thể
  @Get('history/long-term')
  async getLongTermHistory(
    @Query('type') type: string,
    @Query('limit') limit?: string,
  ) {
    if (!type) {
      throw new BadRequestException('Query parameter "type" is required');
    }
    const maxLimit = limit ? parseInt(limit, 10) : 100;
    const data = await this.sensorService.getLongTermHistory(type, maxLimit);
    return { data };
  }

  // Quản lý ngưỡng: Lấy toàn bộ cấu hình ngưỡng của một đập
  @Get('thresholds')
  async getThresholdConfigs(@Query('damId') damId: string) {
    const targetDamId = damId || 'dam_1';
    const configs = await this.sensorService.getThresholdConfigs(targetDamId);
    return { configs };
  }

  // Quản lý ngưỡng: Cập nhật cấu hình ngưỡng
  @Put('thresholds/:id')
  async updateThresholdConfig(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const updated = await this.sensorService.updateThresholdConfig(id, body);
    return { ok: true, data: updated };
  }
}

