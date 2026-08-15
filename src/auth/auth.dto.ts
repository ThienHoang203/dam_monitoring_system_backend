import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import type { UserRole, UserStatus } from './entities/user.entity';

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Tên đăng nhập không được để trống' })
  username: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải từ 6 ký tự trở lên' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  fullName: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  assignedDamId?: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên đăng nhập hoặc Email không được để trống' })
  usernameOrEmail: string;

  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
}

export class ApproveUserDto {
  @IsOptional()
  @IsString()
  role?: UserRole;

  @IsOptional()
  @IsString()
  assignedDamId?: string;

  @IsOptional()
  @IsString()
  status?: UserStatus;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  role?: UserRole;

  @IsOptional()
  @IsString()
  status?: UserStatus;

  @IsOptional()
  @IsString()
  assignedDamId?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  password?: string;
}
