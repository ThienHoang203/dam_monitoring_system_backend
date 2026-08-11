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

@Controller()
export class DamController {
  constructor(private readonly damService: DamService) {}

  // ── Dam Endpoints ──
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
  async createDam(@Body() dto: CreateDamDto) {
    const dam = await this.damService.createDam(dto);
    return { ok: true, dam };
  }

  @Put('dams/:id')
  async updateDam(@Param('id') id: string, @Body() dto: UpdateDamDto) {
    const dam = await this.damService.updateDam(id, dto);
    return { ok: true, dam };
  }

  @Delete('dams/:id')
  async deleteDam(@Param('id') id: string) {
    return this.damService.deleteDam(id);
  }

  // ── Station Endpoints ──
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
  async createStation(@Body() dto: CreateStationDto) {
    const station = await this.damService.createStation(dto);
    return { ok: true, station };
  }

  @Put('stations/:id')
  async updateStation(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStationDto,
  ) {
    const station = await this.damService.updateStation(id, dto);
    return { ok: true, station };
  }

  @Delete('stations/:id')
  async deleteStation(@Param('id', ParseIntPipe) id: number) {
    return this.damService.deleteStation(id);
  }
}
