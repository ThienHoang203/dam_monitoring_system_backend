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
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { DamService } from './dam.service';
import { CreateDamDto, UpdateDamDto, CreateStationDto, UpdateStationDto } from './dam.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

@Controller()
export class DamController {
  constructor(private readonly damService: DamService) {}

  // ── Dam Endpoints ──
  @Get('dams')
  @UseGuards(OptionalJwtAuthGuard)
  async findAllDams(@CurrentUser() user?: User) {
    let dams = await this.damService.findAllDams();
    // Nếu là Cán bộ OPERATOR có gán đập cụ thể -> Chỉ hiển thị đập được phân công
    if (user?.role === 'OPERATOR' && user?.assignedDamId) {
      dams = dams.filter(d => d.id === user.assignedDamId);
    }
    return { dams };
  }

  @Get('dams/:id')
  @UseGuards(OptionalJwtAuthGuard)
  async findDamById(@Param('id') id: string, @CurrentUser() user?: User) {
    // Nếu là OPERATOR cố tình truy cập đập khác ngoài phạm vi được phân công
    if (user?.role === 'OPERATOR' && user?.assignedDamId && user.assignedDamId !== id) {
      throw new ForbiddenException('Bạn không có quyền truy cập đập thủy điện này');
    }
    const dam = await this.damService.findDamById(id);
    return { dam };
  }

  @Post('dams')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async createDam(@Body() dto: CreateDamDto) {
    const dam = await this.damService.createDam(dto);
    return { ok: true, dam };
  }

  @Put('dams/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async updateDam(@Param('id') id: string, @Body() dto: UpdateDamDto) {
    const dam = await this.damService.updateDam(id, dto);
    return { ok: true, dam };
  }

  @Delete('dams/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async deleteDam(@Param('id') id: string) {
    return this.damService.deleteDam(id);
  }

  // ── Station Endpoints ──
  @Get('stations')
  @UseGuards(OptionalJwtAuthGuard)
  async findAllStations(@Query('damId') damId?: string, @CurrentUser() user?: User) {
    let effectiveDamId = damId;
    if (user?.role === 'OPERATOR' && user?.assignedDamId) {
      effectiveDamId = user.assignedDamId;
    }
    const stations = await this.damService.findAllStations(effectiveDamId);
    return { stations };
  }

  @Get('stations/:id')
  @UseGuards(OptionalJwtAuthGuard)
  async findStationById(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: User) {
    const station = await this.damService.findStationById(id);
    if (user?.role === 'OPERATOR' && user?.assignedDamId && station.damId !== user.assignedDamId) {
      throw new ForbiddenException('Bạn không có quyền truy cập trạm quan trắc của đập này');
    }
    return { station };
  }

  @Post('stations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async createStation(@Body() dto: CreateStationDto) {
    const station = await this.damService.createStation(dto);
    return { ok: true, station };
  }

  @Put('stations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async updateStation(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStationDto,
  ) {
    const station = await this.damService.updateStation(id, dto);
    return { ok: true, station };
  }

  @Delete('stations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async deleteStation(@Param('id', ParseIntPipe) id: number) {
    return this.damService.deleteStation(id);
  }
}
