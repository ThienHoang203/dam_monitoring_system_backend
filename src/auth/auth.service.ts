import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { RegisterDto, LoginDto, ApproveUserDto, UpdateUserDto } from './auth.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultAdmin();
  }

  async seedDefaultAdmin() {
    const adminCount = await this.userRepo.count({ where: { role: 'ADMIN' } });
    if (adminCount > 0) return;

    console.log('[AuthService] Seeding default Admin user (admin / admin123456)...');
    const passwordHash = await bcrypt.hash('admin123456', 10);
    const admin = this.userRepo.create({
      username: 'admin',
      email: 'admin@damsafe.gov.vn',
      fullName: 'Quản trị viên Hệ thống',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      phoneNumber: '0988888888',
    });
    await this.userRepo.save(admin);
    console.log('[AuthService] Default Admin user created successfully!');
  }

  async register(dto: RegisterDto): Promise<{ message: string; user: Partial<User> }> {
    const existingEmail = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('Email này đã được sử dụng');
    }

    const existingUsername = await this.userRepo.findOne({ where: { username: dto.username } });
    if (existingUsername) {
      throw new ConflictException('Tên đăng nhập này đã được sử dụng');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email,
      username: dto.username,
      passwordHash,
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      assignedDamId: dto.assignedDamId,
      role: 'OPERATOR',
      status: 'PENDING_APPROVAL',
    });

    await this.userRepo.save(user);

    await this.auditLogService.logAction({
      action: 'REGISTER',
      category: 'AUTH',
      description: `Đăng ký tài khoản mới: ${user.fullName || user.username} (${user.email})`,
      username: user.username,
      userRole: user.role,
      metadata: { email: user.email, assignedDamId: user.assignedDamId },
    });

    const { passwordHash: _, ...result } = user;
    return {
      message: 'Đăng ký tài khoản thành công! Vui lòng chờ Quản trị viên phê duyệt tài khoản.',
      user: result,
    };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; user: Partial<User> }> {
    const user = await this.userRepo.findOne({
      where: [
        { username: dto.usernameOrEmail },
        { email: dto.usernameOrEmail },
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Tên đăng nhập hoặc email không tồn tại');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Mật khẩu không chính xác');
    }

    if (user.status === 'PENDING_APPROVAL') {
      throw new UnauthorizedException('Tài khoản của bạn đang chờ Quản trị viên phê duyệt. Vui lòng liên hệ Admin.');
    }

    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.');
    }

    user.lastLoginAt = new Date();
    await this.userRepo.save(user);

    await this.auditLogService.logAction({
      action: 'LOGIN',
      category: 'AUTH',
      description: `Tài khoản "${user.username}" (${user.role}) đã đăng nhập vào hệ thống`,
      username: user.username,
      userRole: user.role,
    });

    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      assignedDamId: user.assignedDamId,
    };

    const accessToken = this.jwtService.sign(payload);

    const { passwordHash: _, ...userProfile } = user;
    return {
      accessToken,
      user: userProfile,
    };
  }

  async getProfile(userId: string): Promise<Partial<User>> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Người dùng không tồn tại');
    const { passwordHash: _, ...result } = user;
    return result;
  }

  // ── Quản lý Users cho Admin ──
  async findAllUsers(): Promise<Partial<User>[]> {
    const users = await this.userRepo.find({ order: { createdAt: 'DESC' } });
    return users.map(({ passwordHash: _, ...u }) => u);
  }

  async findUserById(id: string): Promise<User> {
    const user = await this.findUserById(id);
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng mã ${id}`);
    return user;
  }

  async approveUser(id: string, dto: ApproveUserDto): Promise<Partial<User>> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng mã ${id}`);
    user.status = dto.status || 'ACTIVE';
    if (dto.role) user.role = dto.role;
    if (dto.assignedDamId) user.assignedDamId = dto.assignedDamId;

    await this.userRepo.save(user);

    await this.auditLogService.logAction({
      action: 'APPROVE_USER',
      category: 'AUTH',
      description: `Quản trị viên đã phê duyệt tài khoản "${user.username}" (Role: ${user.role}, Đập: ${user.assignedDamId || 'Tất cả'})`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<Partial<User>> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng mã ${id}`);
    if (dto.fullName) user.fullName = dto.fullName;
    if (dto.phoneNumber !== undefined) user.phoneNumber = dto.phoneNumber;
    if (dto.role) user.role = dto.role;
    if (dto.status) user.status = dto.status;
    if (dto.assignedDamId !== undefined) user.assignedDamId = dto.assignedDamId;

    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    await this.userRepo.save(user);

    await this.auditLogService.logAction({
      action: 'UPDATE_USER',
      category: 'AUTH',
      description: `Cập nhật thông tin tài khoản "${user.username}" (Role mới: ${user.role}, Trạng thái: ${user.status})`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async deleteUser(id: string): Promise<{ ok: boolean }> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng mã ${id}`);
    if (user.role === 'ADMIN') {
      const adminCount = await this.userRepo.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        throw new BadRequestException('Không thể xóa tài khoản Admin duy nhất trong hệ thống');
      }
    }
    await this.userRepo.remove(user);

    await this.auditLogService.logAction({
      action: 'DELETE_USER',
      category: 'AUTH',
      description: `Xóa tài khoản người dùng "${user.username}"`,
      username: 'admin',
      userRole: 'ADMIN',
    });

    return { ok: true };
  }
}
