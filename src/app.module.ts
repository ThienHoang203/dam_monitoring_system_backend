import { Module } from '@nestjs/common';
import { SensorModule } from './sensor/sensor.module';
import { SensorController } from 'src/sensor/sensor.controller';
import { SensorService } from 'src/sensor/sensor.service';
import { SensorGateway } from 'src/gateway/sensor.gateway';

@Module({
  imports: [SensorModule],
  controllers: [SensorController],
  providers: [SensorService, SensorGateway],
})
export class AppModule {}
