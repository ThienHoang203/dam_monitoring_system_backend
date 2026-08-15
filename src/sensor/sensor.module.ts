import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SensorService } from './sensor.service';
import { SensorController } from './sensor.controller';
import { SensorGateway } from '../gateway/sensor.gateway';
import { SensorReading } from './entities/sensor-reading.entity';
import { ThresholdConfig } from './entities/threshold-config.entity';
import { AlarmEvent } from './entities/alarm-event.entity';
import { StationStatusHistory } from './entities/station-status-history.entity';
import { Station } from '../dam/entities/station.entity';
import { Dam } from '../dam/entities/dam.entity';
import { SensorBufferService } from './sensor-buffer.service';
import { DownsamplerService } from './downsampler.service';
import { Gateway } from '../gateway/entities/gateway.entity';
import { Node } from '../node/entities/node.entity';
import { Evidence } from '../evidence/entities/evidence.entity';
import { User } from '../auth/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SensorReading,
      ThresholdConfig,
      AlarmEvent,
      StationStatusHistory,
      Station,
      Dam,
      Gateway,
      Node,
      Evidence,
      User,
    ]),
  ],
  controllers: [SensorController],
  providers: [
    SensorService,
    SensorGateway,
    SensorBufferService,
    DownsamplerService,
  ],
  exports: [SensorService, SensorGateway],
})
export class SensorModule { }


