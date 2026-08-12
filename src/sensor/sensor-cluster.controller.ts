import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { SensorClusterService } from './sensor-cluster.service';
import {
  CreateSensorClusterDto,
  UpdateSensorClusterDto,
  CreateSensorDeviceDto,
  UpdateSensorDeviceDto,
} from './sensor-cluster.dto';

@Controller('sensor-clusters')
export class SensorClusterController {
  constructor(private readonly clusterService: SensorClusterService) {}

  // GET /sensor-clusters?stationId=1&damId=dam_1
  @Get()
  async findAll(
    @Query('stationId') stationId?: string,
    @Query('damId') damId?: string,
  ) {
    const stId = stationId ? parseInt(stationId, 10) : undefined;
    const clusters = await this.clusterService.findAll(stId, damId);
    return { clusters };
  }

  // GET /sensor-clusters/:id
  @Get(':id')
  async findById(@Param('id') id: string) {
    const cluster = await this.clusterService.findById(id);
    return { cluster };
  }

  // POST /sensor-clusters
  @Post()
  async create(@Body() dto: CreateSensorClusterDto) {
    const cluster = await this.clusterService.create(dto);
    return { ok: true, cluster };
  }

  // PUT /sensor-clusters/:id
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSensorClusterDto,
  ) {
    const cluster = await this.clusterService.update(id, dto);
    return { ok: true, cluster };
  }

  // DELETE /sensor-clusters/:id
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.clusterService.delete(id);
  }

  // ── Device Endpoints ──

  // POST /sensor-clusters/:id/devices
  @Post(':id/devices')
  async addDevice(
    @Param('id') clusterId: string,
    @Body() dto: CreateSensorDeviceDto,
  ) {
    const device = await this.clusterService.addDevice(clusterId, dto);
    return { ok: true, device };
  }

  // PUT /sensor-clusters/:id/devices/:deviceId
  @Put(':id/devices/:deviceId')
  async updateDevice(
    @Param('id') _clusterId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateSensorDeviceDto,
  ) {
    const device = await this.clusterService.updateDevice(deviceId, dto);
    return { ok: true, device };
  }

  // DELETE /sensor-clusters/:id/devices/:deviceId
  @Delete(':id/devices/:deviceId')
  async removeDevice(
    @Param('id') _clusterId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.clusterService.removeDevice(deviceId);
  }
}
