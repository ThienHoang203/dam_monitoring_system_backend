import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dam } from './entities/dam.entity';
import { Station } from './entities/station.entity';
import { DamService } from './dam.service';
import { DamController } from './dam.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Dam, Station])],
  controllers: [DamController],
  providers: [DamService],
  exports: [DamService],
})
export class DamModule {}
