import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dam } from './entities/dam.entity';
import { Station } from './entities/station.entity';
import { Gateway } from '../gateway/entities/gateway.entity';
import { Camera } from '../camera/entities/camera.entity';
import { Node } from '../node/entities/node.entity';
import { Sensor } from '../node/entities/sensor.entity';
import { DamService } from './dam.service';
import { DamController } from './dam.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Dam, Station, Gateway, Camera, Node, Sensor])],
  controllers: [DamController],
  providers: [DamService],
  exports: [DamService],
})
export class DamModule {}

