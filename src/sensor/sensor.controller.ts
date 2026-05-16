import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
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
  ingest(@Body() dto: SensorDataDto) {
    if (
      dto.freq == null ||
      dto.amp == null ||
      dto.waterLevel == null ||
      dto.moisture == null
    ) {
      throw new BadRequestException('Missing required sensor fields');
    }

    const snapshot = this.sensorService.ingest(dto);
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
}
