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
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
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
    private readonly configService: ConfigService,
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

  // ── Đăng ký tài khoản (mặc định status: PENDING_APPROVAL chờ duyệt) ──
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

    // Ghi nhật ký hệ thống
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

  // ── Đăng nhập ──
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

    // Ghi nhật ký login
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
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng mã ${id}`);
    return user;
  }

  async approveUser(id: string, dto: ApproveUserDto): Promise<Partial<User>> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng mã ${id}`);

    const wasPending = user.status === 'PENDING_APPROVAL';
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

    // Nếu duyệt từ PENDING_APPROVAL sang ACTIVE lần đầu -> Gửi email thông báo cho chủ tài khoản
    if (wasPending && user.status === 'ACTIVE' && user.email) {
      this.sendApprovalEmail(user).catch((err) =>
        console.error('[AuthService] Lỗi async khi gửi approval email:', err),
      );
    }

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<Partial<User>> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng mã ${id}`);

    const wasPending = user.status === 'PENDING_APPROVAL';
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

    // Nếu cập nhật trạng thái từ PENDING_APPROVAL sang ACTIVE -> Gửi email thông báo
    if (wasPending && user.status === 'ACTIVE' && user.email) {
      this.sendApprovalEmail(user).catch((err) =>
        console.error('[AuthService] Lỗi async khi gửi approval email:', err),
      );
    }

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

  // ── Gửi Email thông báo khi tài khoản được phê duyệt ──
  async sendApprovalEmail(user: User): Promise<void> {
    if (!user.email) return;

    const host = this.configService.get<string>('SMTP_HOST', 'smtp.gmail.com');
    const port = Number(this.configService.get<number>('SMTP_PORT', 587));
    const smtpUser = this.configService.get<string>('SMTP_USER', '');
    const smtpPass = this.configService.get<string>('SMTP_PASS', '');

    const roleName =
      user.role === 'ADMIN'
        ? 'Quản trị viên (ADMIN)'
        : user.role === 'OPERATOR'
        ? 'Cán bộ Vận hành (OPERATOR)'
        : 'Khách quan sát (VIEWER)';
    const damAssignment = user.assignedDamId
      ? `Đập được phân công: <strong>${user.assignedDamId}</strong>`
      : 'Phạm vi: <strong>Toàn bộ hệ thống</strong>';

    const subject = `[THÔNG BÁO] Tài khoản Cán bộ của bạn đã được phê duyệt thành công`;

    const htmlBody = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff; box-shadow: 0 10px 30px rgba(0,0,0,0.08);">
        <div style="background: linear-gradient(135deg, #0284c7 0%, #4f46e5 100%); color: #ffffff; padding: 30px 24px; text-align: center;">
          <div style="font-size: 32px; margin-bottom: 8px;">🎉</div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px;">TÀI KHOẢN ĐÃ ĐƯỢC PHÊ DUYỆT</h1>
          <p style="margin: 8px 0 0 0; font-size: 13px; opacity: 0.9;">Hệ Thống Giám Sát & Quản Lý An Toàn Đập Thủy Điện</p>
        </div>
        <div style="padding: 30px 24px;">
          <p style="font-size: 15px; color: #1e293b; margin-top: 0;">
            Kính gửi <strong>${user.fullName || user.username}</strong>,
          </p>
          <div style="background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 14px 18px; margin-bottom: 24px; border-radius: 6px;">
            <p style="margin: 0; color: #166534; font-size: 14px; line-height: 1.6;">
              Yêu cầu đăng ký tài khoản cán bộ của bạn đã được <strong>Quản trị viên (Admin)</strong> phê duyệt thành công. Bạn đã có thể đăng nhập vào hệ thống để bắt đầu làm việc.
            </p>
          </div>

          <h3 style="font-size: 13px; text-transform: uppercase; color: #64748b; margin: 0 0 12px 0; letter-spacing: 0.8px;">Thông tin tài khoản cán bộ:</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 26px; font-size: 13.5px;">
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #64748b; width: 40%;">👤 Tên đăng nhập:</td>
              <td style="padding: 10px 0; color: #0f172a; font-weight: bold;">${user.username}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #64748b;">📧 Email công vụ:</td>
              <td style="padding: 10px 0; color: #0f172a;">${user.email}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #64748b;">🛡️ Quyền hạn:</td>
              <td style="padding: 10px 0; color: #4f46e5; font-weight: bold;">${roleName}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #64748b;">📍 Phân công:</td>
              <td style="padding: 10px 0; color: #0f172a;">${damAssignment}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #64748b;">⚡ Trạng thái:</td>
              <td style="padding: 10px 0; color: #16a34a; font-weight: bold;">ĐANG HOẠT ĐỘNG (ACTIVE)</td>
            </tr>
          </table>

          <div style="text-align: center; margin: 30px 0 10px 0;">
            <a href="http://localhost:3000/login" style="background: linear-gradient(135deg, #0284c7, #4f46e5); color: #ffffff; padding: 13px 32px; text-decoration: none; font-weight: bold; font-size: 14px; border-radius: 10px; display: inline-block; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);">
              🚀 ĐĂNG NHẬP VÀO HỆ THỐNG
            </a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          Email thông báo tự động từ Hệ thống Giám sát & Quản lý An toàn Đập Thủy điện.
        </div>
      </div>
    `;

    console.log(`[AuthService] Chuẩn bị gửi email thông báo phê duyệt tài khoản tới: ${user.email}`);

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
    });

    try {
      if (!smtpUser || smtpPass === 'app_password_here' || !smtpPass) {
        console.warn(
          `[AuthService] SMTP chưa được cấu hình mật khẩu thực tế trong .env. Đã ghi nhận lệnh gửi email phê duyệt giả lập thành công tới: ${user.email}`,
        );
        return;
      }

      const info = await transporter.sendMail({
        from: `"Hệ thống Giám sát Hồ đập" <${smtpUser}>`,
        to: user.email,
        subject,
        html: htmlBody,
      });

      console.log(
        `[AuthService] Đã gửi Email phê duyệt thành công tới ${user.email}! MessageId: ${info.messageId}`,
      );
    } catch (err: any) {
      console.error(`[AuthService] Lỗi khi gửi Email phê duyệt tới ${user.email}:`, err);
    }
  }
}
