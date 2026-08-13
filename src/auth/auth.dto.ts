import { UserRole, UserStatus } from './entities/user.entity';

export class RegisterDto {
  email: string;
  username: string;
  password: string;
  fullName: string;
  phoneNumber?: string;
  assignedDamId?: string;
}

export class LoginDto {
  usernameOrEmail: string;
  password: string;
}

export class ApproveUserDto {
  role?: UserRole;
  assignedDamId?: string;
  status?: UserStatus;
}

export class UpdateUserDto {
  fullName?: string;
  phoneNumber?: string;
  role?: UserRole;
  status?: UserStatus;
  assignedDamId?: string;
  password?: string;
}
