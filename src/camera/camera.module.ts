import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Camera } from './entities/camera.entity';
import { CameraService } from './camera.service';
import { CameraController } from './camera.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Camera])],
  controllers: [CameraController],
  providers: [CameraService],
  exports: [CameraService, TypeOrmModule],
})
export class CameraModule {}
