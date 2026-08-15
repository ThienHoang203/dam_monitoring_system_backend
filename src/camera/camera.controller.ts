import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { CameraService } from './camera.service';
import { CreateCameraDto, UpdateCameraDto } from './camera.dto';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('api/cameras')
export class CameraController {
  constructor(private readonly cameraService: CameraService) {}

  @Get()
  @Roles('ADMIN', 'OPERATOR')
  async findAll(@Query('gatewayId') gatewayId?: string) {
    const cameras = await this.cameraService.findAll(gatewayId);
    return { cameras };
  }

  @Get(':id')
  @Roles('ADMIN', 'OPERATOR')
  async findById(@Param('id') id: string) {
    const camera = await this.cameraService.findById(id);
    return { camera };
  }

  @Post()
  @Roles('ADMIN')
  async create(@Body() dto: CreateCameraDto) {
    const camera = await this.cameraService.create(dto);
    return { ok: true, camera };
  }

  @Put(':id')
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() dto: UpdateCameraDto) {
    const camera = await this.cameraService.update(id, dto);
    return { ok: true, camera };
  }

  @Delete(':id')
  @Roles('ADMIN')
  async delete(@Param('id') id: string) {
    return this.cameraService.delete(id);
  }
}
