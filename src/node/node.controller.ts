import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { NodeService } from './node.service';
import {
  CreateNodeDto,
  UpdateNodeDto,
  CreateSensorDto,
  UpdateSensorDto,
} from './node.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

@Controller('api/nodes')
export class NodeController {
  constructor(private readonly nodeService: NodeService) {}

  // ── Node CRUD ──

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async findAll(
    @Query('gatewayId') gatewayId?: string,
    @Query('stationId') stationId?: string,
    @Query('damId') damId?: string,
    @CurrentUser() user?: User,
  ) {
    let effectiveDamId = damId;
    if (user?.role === 'OPERATOR' && user?.assignedDamId) {
      effectiveDamId = user.assignedDamId;
    }
    const nodes = await this.nodeService.findAll(
      gatewayId,
      stationId ? parseInt(stationId, 10) : undefined,
      effectiveDamId,
    );
    return { nodes };
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async findById(@Param('id') id: string, @CurrentUser() user?: User) {
    const node = await this.nodeService.findById(id);
    if (
      user?.role === 'OPERATOR' &&
      user?.assignedDamId &&
      node.gateway?.station?.damId &&
      node.gateway.station.damId !== user.assignedDamId
    ) {
      throw new ForbiddenException('Bạn không có quyền truy cập Sensor Node của đập này');
    }
    return { node };
  }

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  async create(@Body() dto: CreateNodeDto) {
    const node = await this.nodeService.create(dto);
    return { ok: true, node };
  }

  @Put(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateNodeDto, @CurrentUser() user?: User) {
    const existing = await this.nodeService.findById(id);
    if (
      user?.role === 'OPERATOR' &&
      user?.assignedDamId &&
      existing.gateway?.station?.damId &&
      existing.gateway.station.damId !== user.assignedDamId
    ) {
      throw new ForbiddenException('Bạn không có quyền chỉnh sửa Sensor Node của đập khác');
    }
    const node = await this.nodeService.update(id, dto);
    return { ok: true, node };
  }

  @Delete(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async delete(@Param('id') id: string, @CurrentUser() user?: User) {
    const existing = await this.nodeService.findById(id);
    if (
      user?.role === 'OPERATOR' &&
      user?.assignedDamId &&
      existing.gateway?.station?.damId &&
      existing.gateway.station.damId !== user.assignedDamId
    ) {
      throw new ForbiddenException('Bạn không có quyền xóa Sensor Node của đập khác');
    }
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
