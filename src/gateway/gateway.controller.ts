import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { CreateGatewayDto, UpdateGatewayDto } from './gateway.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { GatewayApiKeyGuard } from '../auth/guards/gateway-api-key.guard';

@Controller()
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  // ── CRUD Endpoints (plural: /api/gateways) ──

  @Get('api/gateways')
  @Roles('ADMIN', 'OPERATOR')
  async findAll(
    @Query('stationId') stationId?: string,
    @Query('damId') damId?: string,
    @CurrentUser() user?: User,
  ) {
    // OPERATOR chỉ được thấy gateway thuộc đập được phân công, bất kể query gửi lên gì.
    let effectiveDamId = damId;
    if (user?.role === 'OPERATOR' && user?.assignedDamId) {
      effectiveDamId = user.assignedDamId;
    }
    const gateways = await this.gatewayService.findAll(
      stationId || undefined,
      effectiveDamId || undefined,
    );
    return { gateways };
  }

  @Get('api/gateways/:id')
  @Roles('ADMIN', 'OPERATOR')
  async findById(@Param('id') id: string) {
    const gateway = await this.gatewayService.findById(id);
    return { gateway };
  }

  @Post('api/gateways')
  @Roles('ADMIN', 'OPERATOR')
  async create(@Body() dto: CreateGatewayDto, @CurrentUser() user?: User) {
    if (user?.role === 'OPERATOR' && user?.assignedDamId) {
      const station = await this.gatewayService.resolveStation(dto.stationId);
      if (station.dam?.damId && station.dam.damId !== user.assignedDamId) {
        throw new ForbiddenException('Bạn không có quyền tạo Gateway cho đập khác');
      }
    }
    const gateway = await this.gatewayService.create(dto);
    return { ok: true, gateway };
  }

  @Put('api/gateways/:id')
  @Roles('ADMIN', 'OPERATOR')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGatewayDto,
    @CurrentUser() user?: User,
  ) {
    if (user?.role === 'OPERATOR' && user?.assignedDamId) {
      const existing = await this.gatewayService.findById(id);
      if (
        existing.station?.dam?.damId &&
        existing.station.dam.damId !== user.assignedDamId
      ) {
        throw new ForbiddenException('Bạn không có quyền chỉnh sửa Gateway của đập khác');
      }
      if (dto.stationId) {
        const newStation = await this.gatewayService.resolveStation(dto.stationId);
        if (newStation.dam?.damId && newStation.dam.damId !== user.assignedDamId) {
          throw new ForbiddenException('Bạn không thể chuyển Gateway sang đập khác');
        }
      }
    }
    // Khi đổi trạm, gatewayId được sinh lại theo trạm mới — `renamedFrom` báo cho client biết
    // để cảnh báo admin/operator: thiết bị Jetson vật lý phải được cấu hình lại thủ công.
    const { gateway, renamedFrom } = await this.gatewayService.update(id, dto);
    return { ok: true, gateway, renamedFrom };
  }

  @Delete('api/gateways/:id')
  @Roles('ADMIN', 'OPERATOR')
  async delete(@Param('id') id: string, @CurrentUser() user?: User) {
    if (user?.role === 'OPERATOR' && user?.assignedDamId) {
      const existing = await this.gatewayService.findById(id);
      if (
        existing.station?.dam?.damId &&
        existing.station.dam.damId !== user.assignedDamId
      ) {
        throw new ForbiddenException('Bạn không có quyền xóa Gateway của đập khác');
      }
    }
    return this.gatewayService.delete(id);
  }

  // ── Config Sync Endpoint (singular: /api/gateway/:id/config) ──
  // Endpoint Jetson TX2 gọi khi khởi động để lấy cấu hình
  @Public()
  @UseGuards(GatewayApiKeyGuard)
  @Get('api/gateway/:id/config')
  async getConfig(
    @Param('id') id: string,
    @Headers('x-gateway-api-key') apiKey?: string,
  ) {
    this.gatewayService.validateGatewayApiKey(apiKey);
    return this.gatewayService.getGatewayConfig(id);
  }
}
