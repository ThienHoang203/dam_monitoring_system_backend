import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SensorService } from './sensor.service';
import { SensorController } from './sensor.controller';
import { SensorGateway } from '../gateway/sensor.gateway';
import { SensorReading } from './entities/sensor-reading.entity';
import { ThresholdConfig } from './entities/threshold-config.entity';
import { AlarmEvent } from './entities/alarm-event.entity';
import { SensorBufferService } from './sensor-buffer.service';
import { VibrationWindowService } from './vibration-window.service';
import { DownsamplerService } from './downsampler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SensorReading, ThresholdConfig, AlarmEvent]),
  ],
  controllers: [SensorController],
  providers: [
    SensorService,
    SensorGateway,
    SensorBufferService,
    VibrationWindowService,
    DownsamplerService,
  ],
  exports: [SensorService],
})
export class SensorModule {}

