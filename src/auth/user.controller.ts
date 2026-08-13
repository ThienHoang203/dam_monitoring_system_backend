import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApproveUserDto, UpdateUserDto } from './auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';

@Controller('users')
export class UserController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async findAllUsers() {
    const users = await this.authService.findAllUsers();
    return { users };
  }

  @Put(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async approveUser(@Param('id') id: string, @Body() dto: ApproveUserDto) {
    const user = await this.authService.approveUser(id, dto);
    return { ok: true, user };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const user = await this.authService.updateUser(id, dto);
    return { ok: true, user };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async deleteUser(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }
}
