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
import { NodeService } from './node.service';
import {
  CreateNodeDto,
  UpdateNodeDto,
  CreateSensorDto,
  UpdateSensorDto,
} from './node.dto';

@Controller('api/nodes')
export class NodeController {
  constructor(private readonly nodeService: NodeService) {}

  // ── Node CRUD ──

  @Get()
  async findAll(@Query('gatewayId') gatewayId?: string) {
    const nodes = await this.nodeService.findAll(gatewayId);
    return { nodes };
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const node = await this.nodeService.findById(id);
    return { node };
  }

  @Post()
  async create(@Body() dto: CreateNodeDto) {
    const node = await this.nodeService.create(dto);
    return { ok: true, node };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateNodeDto) {
    const node = await this.nodeService.update(id, dto);
    return { ok: true, node };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.nodeService.delete(id);
  }

  // ── Node → Camera Mapping ──

  @Put(':id/map-camera')
  async mapCamera(
    @Param('id') nodeId: string,
    @Body() body: { cameraId: string | null },
  ) {
    const node = await this.nodeService.mapCamera(nodeId, body.cameraId);
    return { ok: true, node };
  }

  // ── Sensor CRUD (nested under Node) ──

  @Get(':nodeId/sensors')
  async findSensors(@Param('nodeId') nodeId: string) {
    const sensors = await this.nodeService.findSensorsByNode(nodeId);
    return { sensors };
  }

  @Post(':nodeId/sensors')
  async addSensor(
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateSensorDto,
  ) {
    const sensor = await this.nodeService.addSensor(nodeId, dto);
    return { ok: true, sensor };
  }

  @Put(':nodeId/sensors/:sensorId')
  async updateSensor(
    @Param('sensorId') sensorId: string,
    @Body() dto: UpdateSensorDto,
  ) {
    const sensor = await this.nodeService.updateSensor(sensorId, dto);
    return { ok: true, sensor };
  }

  @Delete(':nodeId/sensors/:sensorId')
  async removeSensor(@Param('sensorId') sensorId: string) {
    return this.nodeService.removeSensor(sensorId);
  }
}
