import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Camera } from './entities/camera.entity';
import { CameraService } from './camera.service';
import { CameraController } from './camera.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Camera]),
    forwardRef(() => GatewayModule),
  ],
  controllers: [CameraController],
  providers: [CameraService],
  exports: [CameraService, TypeOrmModule],
})
export class CameraModule {}
