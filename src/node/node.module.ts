import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Node } from './entities/node.entity';
import { Sensor } from './entities/sensor.entity';
import { NodeService } from './node.service';
import { NodeController } from './node.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { SensorModule } from '../sensor/sensor.module';
import { CameraModule } from '../camera/camera.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Node, Sensor]),
    GatewayModule,
    SensorModule,
    CameraModule,
  ],
  controllers: [NodeController],
  providers: [NodeService],
  exports: [NodeService, TypeOrmModule],
})
export class NodeModule {}
