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
import { DamService } from './dam.service';
import { CreateDamDto, UpdateDamDto, CreateStationDto, UpdateStationDto } from './dam.dto';

import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller()
export class DamController {
  constructor(private readonly damService: DamService) {}

  // ── Dam Endpoints (GET là Công Khai cho Khách xem VIEWER) ──
  @Get('dams')
  async findAllDams() {
    const dams = await this.damService.findAllDams();
    return { dams };
  }

  @Get('dams/:id')
  async findDamById(@Param('id') id: string) {
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

  // ── Station Endpoints (GET là Công Khai cho Khách xem VIEWER) ──
  @Get('stations')
  async findAllStations(@Query('damId') damId?: string) {
    const stations = await this.damService.findAllStations(damId);
    return { stations };
  }

  @Get('stations/:id')
  async findStationById(@Param('id', ParseIntPipe) id: number) {
    const station = await this.damService.findStationById(id);
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
