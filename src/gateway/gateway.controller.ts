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
import { GatewayService } from './gateway.service';
import { CreateGatewayDto, UpdateGatewayDto } from './gateway.dto';

@Controller()
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  // ── CRUD Endpoints (plural: /api/gateways) ──

  @Get('api/gateways')
  async findAll(@Query('stationId') stationId?: string) {
    const stId = stationId ? parseInt(stationId, 10) : undefined;
    const gateways = await this.gatewayService.findAll(stId);
    return { gateways };
  }

  @Get('api/gateways/:id')
  async findById(@Param('id') id: string) {
    const gateway = await this.gatewayService.findById(id);
    return { gateway };
  }

  @Post('api/gateways')
  async create(@Body() dto: CreateGatewayDto) {
    const gateway = await this.gatewayService.create(dto);
    return { ok: true, gateway };
  }

  @Put('api/gateways/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateGatewayDto) {
    const gateway = await this.gatewayService.update(id, dto);
    return { ok: true, gateway };
  }

  @Delete('api/gateways/:id')
  async delete(@Param('id') id: string) {
    return this.gatewayService.delete(id);
  }

  // ── Config Sync Endpoint (singular: /api/gateway/:id/config) ──
  // This is the endpoint the Jetson TX2 calls on startup and periodically.
  // Path uses singular "gateway" to match the Jetson's fetch_initial_config() URL.
  @Get('api/gateway/:id/config')
  async getConfig(@Param('id') id: string) {
    return this.gatewayService.getGatewayConfig(id);
  }
}
