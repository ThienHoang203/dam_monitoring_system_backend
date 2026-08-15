import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, UpdateProfileDto } from './auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from './entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const data = await this.authService.login(dto);

    // Lưu Access Token vào Cookie HttpOnly
    res.cookie('access_token', data.accessToken, {
      httpOnly: true,
      secure: false, // Set true khi dùng HTTPS
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
    });

    return data;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    return { ok: true, message: 'Đã đăng xuất khỏi hệ thống' };
  }

  @Get('me')
  async getMe(@CurrentUser() user: User) {
    return this.authService.getProfile(user.id);
  }

  @Put('me')
  async updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    const updated = await this.authService.updateProfile(user.id, dto);
    return { ok: true, user: updated };
  }
}
