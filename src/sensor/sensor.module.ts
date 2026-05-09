import { Module } from '@nestjs/common';
import { SensorService } from './sensor.service';
import { SensorController } from './sensor.controller';
import { SensorGateway } from 'src/gateway/sensor.gateway';

@Module({
  controllers: [SensorController],
  providers: [SensorService, SensorGateway],
  exports: [SensorService]
})
export class SensorModule { }
