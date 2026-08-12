import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SensorService } from './sensor.service';
import { SensorController } from './sensor.controller';
import { SensorGateway } from '../gateway/sensor.gateway';
import { SensorReading } from './entities/sensor-reading.entity';
import { ThresholdConfig } from './entities/threshold-config.entity';
import { AlarmEvent } from './entities/alarm-event.entity';
import { SensorCluster } from './entities/sensor-cluster.entity';
import { SensorDevice } from './entities/sensor-device.entity';
import { Station } from '../dam/entities/station.entity';
import { SensorBufferService } from './sensor-buffer.service';
import { VibrationWindowService } from './vibration-window.service';
import { DownsamplerService } from './downsampler.service';
import { SensorClusterService } from './sensor-cluster.service';
import { SensorClusterController } from './sensor-cluster.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SensorReading,
      ThresholdConfig,
      AlarmEvent,
      SensorCluster,
      SensorDevice,
      Station,
    ]),
  ],
  controllers: [SensorController, SensorClusterController],
  providers: [
    SensorService,
    SensorClusterService,
    SensorGateway,
    SensorBufferService,
    VibrationWindowService,
    DownsamplerService,
  ],
  exports: [SensorService, SensorClusterService],
})
export class SensorModule {}


