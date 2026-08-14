import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gateway } from './entities/gateway.entity';
import { GatewayService } from './gateway.service';
import { GatewayController } from './gateway.controller';
import { CameraModule } from '../camera/camera.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Gateway]),
    CameraModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService],
  exports: [GatewayService, TypeOrmModule],
})
export class GatewayModule {}
