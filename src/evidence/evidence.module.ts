import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Evidence } from './entities/evidence.entity';
import { AlarmEvent } from '../sensor/entities/alarm-event.entity';
import { Gateway } from '../gateway/entities/gateway.entity';
import { Node } from '../node/entities/node.entity';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { SensorModule } from '../sensor/sensor.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Evidence, AlarmEvent, Gateway, Node]),
    SensorModule,
  ],
  controllers: [EvidenceController],
  providers: [EvidenceService],
  exports: [EvidenceService],
})
export class EvidenceModule {}

