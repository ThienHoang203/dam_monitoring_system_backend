import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { createMockRepo, MockRepo } from '../../test/helpers/mock-repo';
import { createConfigService } from '../../test/helpers/exec-context';
import { makeAdmin, makeUser } from '../../test/helpers/factories';
import { sendMailMock, lastSentMail, resetNodemailerMock } from '../../test/mocks/nodemailer.mock';

/**
 * Xác thực & quản lý tài khoản. Hai bất biến bảo mật được kiểm ở đây:
 *  1. `passwordHash` không bao giờ lọt ra response.
 *  2. Người dùng tự đăng ký không thể tự nâng quyền.
 */
describe('AuthService', () => {
  let userRepo: MockRepo<User>;
  let jwtService: { sign: jest.Mock };
  let auditLogService: { logAction: jest.Mock };
  let service: AuthService;

  const build = (config: Record<string, any> = {}) => {
    userRepo = createMockRepo<User>();
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    auditLogService = { logAction: jest.fn().mockResolvedValue(null) };
    return new AuthService(
      userRepo as any,
      jwtService as any,
      auditLogService as any,
      createConfigService(config),
    );
  };

  /** Không method nào được để lộ hash mật khẩu ra ngoài. */
  const expectNoPasswordHash = (result: any) => {
    expect(result).not.toHaveProperty('passwordHash');
  };

  beforeEach(() => {
    resetNodemailerMock();
    service = build();
  });

  describe('register', () => {
    const dto = {
      email: 'new@example.test',
      username: 'newuser',
      password: 'password123',
      fullName: 'Người Dùng Mới',
    } as any;

    it('email đã tồn tại → Conflict', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      await expect(service.register(dto)).rejects.toThrow('Email này đã được sử dụng');
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('username đã tồn tại → Conflict', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null) // email chưa dùng
        .mockResolvedValueOnce(makeUser()); // username đã dùng
      await expect(service.register(dto)).rejects.toThrow('Tên đăng nhập này đã được sử dụng');
    });

    // Chống leo thang đặc quyền: dù client gửi role/status gì, service vẫn ép về
    // OPERATOR + chờ duyệt. Đây là lớp phòng thủ thứ hai sau ValidationPipe whitelist.
    it('LUÔN ép role=OPERATOR và status=PENDING_APPROVAL, bỏ qua dto', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await service.register({ ...dto, role: 'ADMIN', status: 'ACTIVE' } as any);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'OPERATOR', status: 'PENDING_APPROVAL' }),
      );
    });

    it('mật khẩu được hash, không lưu dạng thô', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await service.register(dto);

      const created = userRepo.create.mock.calls[0][0];
      expect(created.passwordHash).not.toBe('password123');
      await expect(bcrypt.compare('password123', created.passwordHash)).resolves.toBe(true);
    });

    it('response không chứa passwordHash', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const { user } = await service.register(dto);
      expectNoPasswordHash(user);
    });

    it('ghi nhật ký hệ thống', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await service.register(dto);
      expect(auditLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REGISTER', category: 'AUTH' }),
      );
    });
  });

  describe('login', () => {
    const password = 'password123';
    let activeUser: User;

    beforeEach(async () => {
      activeUser = makeUser({
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash(password, 10),
      });
    });

    it('tài khoản không tồn tại → Unauthorized', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.login({ usernameOrEmail: 'ghost', password } as any),
      ).rejects.toThrow('Tên đăng nhập hoặc email không tồn tại');
    });

    it('sai mật khẩu → Unauthorized', async () => {
      userRepo.findOne.mockResolvedValue(activeUser);
      await expect(
        service.login({ usernameOrEmail: 'operator1', password: 'wrong' } as any),
      ).rejects.toThrow('Mật khẩu không chính xác');
    });

    it.each([
      ['PENDING_APPROVAL', 'chờ Quản trị viên phê duyệt'],
      ['SUSPENDED', 'đã bị khóa'],
    ])('trạng thái %s → Unauthorized (%s)', async (status, message) => {
      userRepo.findOne.mockResolvedValue({ ...activeUser, status } as any);
      await expect(
        service.login({ usernameOrEmail: 'operator1', password } as any),
      ).rejects.toThrow(new RegExp(message));
    });

    it('đăng nhập thành công → phát token với đúng payload', async () => {
      userRepo.findOne.mockResolvedValue(activeUser);

      const result = await service.login({ usernameOrEmail: 'operator1', password } as any);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: activeUser.id,
        username: activeUser.username,
        email: activeUser.email,
        role: activeUser.role,
        assignedDamId: activeUser.assignedDamId,
      });
      expect(result.accessToken).toBe('signed.jwt.token');
      expectNoPasswordHash(result.user);
    });

    it('cập nhật lastLoginAt', async () => {
      userRepo.findOne.mockResolvedValue(activeUser);
      await service.login({ usernameOrEmail: 'operator1', password } as any);
      expect(activeUser.lastLoginAt).toBeInstanceOf(Date);
    });

    it('chấp nhận đăng nhập bằng cả username lẫn email', async () => {
      userRepo.findOne.mockResolvedValue(activeUser);
      await service.login({ usernameOrEmail: 'operator@example.test', password } as any);

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: [
          { username: 'operator@example.test' },
          { email: 'operator@example.test' },
        ],
      });
    });

    it('kiểm mật khẩu TRƯỚC khi kiểm trạng thái (không lộ tài khoản nào đang chờ duyệt)', async () => {
      userRepo.findOne.mockResolvedValue({ ...activeUser, status: 'PENDING_APPROVAL' } as any);
      await expect(
        service.login({ usernameOrEmail: 'operator1', password: 'wrong' } as any),
      ).rejects.toThrow('Mật khẩu không chính xác');
    });
  });

  describe('deleteUser — chốt chặn ADMIN cuối cùng', () => {
    it('không cho xoá ADMIN duy nhất còn lại', async () => {
      userRepo.findOne.mockResolvedValue(makeAdmin());
      userRepo.count.mockResolvedValue(1);

      await expect(service.deleteUser('admin-uuid')).rejects.toThrow(BadRequestException);
      await expect(service.deleteUser('admin-uuid')).rejects.toThrow(
        'Không thể xóa tài khoản Admin duy nhất trong hệ thống',
      );
      expect(userRepo.remove).not.toHaveBeenCalled();
    });

    it('còn từ 2 ADMIN trở lên thì xoá được', async () => {
      userRepo.findOne.mockResolvedValue(makeAdmin());
      userRepo.count.mockResolvedValue(2);

      await expect(service.deleteUser('admin-uuid')).resolves.toEqual({ ok: true });
      expect(userRepo.remove).toHaveBeenCalled();
    });

    it('xoá OPERATOR không bị chặn dù chỉ có 1 ADMIN', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ role: 'OPERATOR' }));

      await expect(service.deleteUser('user-uuid-1')).resolves.toEqual({ ok: true });
      expect(userRepo.count).not.toHaveBeenCalled();
    });

    it('không tìm thấy người dùng → NotFound', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteUser('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('approveUser', () => {
    it('không tìm thấy → NotFound', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.approveUser('ghost', {} as any)).rejects.toThrow(NotFoundException);
    });

    it('PENDING_APPROVAL → ACTIVE thì gửi email thông báo', async () => {
      const pending = makeUser({ status: 'PENDING_APPROVAL' });
      userRepo.findOne.mockResolvedValue(pending);
      const spy = jest.spyOn(service, 'sendApprovalEmail').mockResolvedValue(undefined);

      await service.approveUser(pending.id, {} as any);

      expect(spy).toHaveBeenCalledWith(pending);
    });

    it('tài khoản vốn đã ACTIVE thì KHÔNG gửi lại email', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ status: 'ACTIVE' }));
      const spy = jest.spyOn(service, 'sendApprovalEmail').mockResolvedValue(undefined);

      await service.approveUser('user-uuid-1', { status: 'ACTIVE' } as any);

      expect(spy).not.toHaveBeenCalled();
    });

    it('không truyền status thì mặc định ACTIVE', async () => {
      const pending = makeUser({ status: 'PENDING_APPROVAL' });
      userRepo.findOne.mockResolvedValue(pending);
      jest.spyOn(service, 'sendApprovalEmail').mockResolvedValue(undefined);

      const result = await service.approveUser(pending.id, {} as any);

      expect(result.status).toBe('ACTIVE');
      expectNoPasswordHash(result);
    });

    // Email hỏng không được làm hỏng thao tác duyệt tài khoản.
    it('lỗi gửi email không làm approveUser thất bại', async () => {
      const pending = makeUser({ status: 'PENDING_APPROVAL' });
      userRepo.findOne.mockResolvedValue(pending);
      jest.spyOn(service, 'sendApprovalEmail').mockRejectedValue(new Error('SMTP down'));

      await expect(service.approveUser(pending.id, {} as any)).resolves.toBeDefined();
    });
  });

  describe('updateUser', () => {
    it('đổi mật khẩu thì rehash và bỏ cờ bắt đổi mật khẩu', async () => {
      const user = makeUser({ mustChangePassword: true });
      userRepo.findOne.mockResolvedValue(user);

      await service.updateUser(user.id, { password: 'newpassword' } as any);

      expect(user.mustChangePassword).toBe(false);
      await expect(bcrypt.compare('newpassword', user.passwordHash)).resolves.toBe(true);
    });

    // phoneNumber dùng `!== undefined` nên xoá số điện thoại (null) là thao tác hợp lệ,
    // khác với các field dùng truthy-check.
    it('cho phép xoá phoneNumber bằng null', async () => {
      const user = makeUser({ phoneNumber: '0900000000' });
      userRepo.findOne.mockResolvedValue(user);

      await service.updateUser(user.id, { phoneNumber: null } as any);

      expect(user.phoneNumber).toBeNull();
    });

    it('field không gửi thì giữ nguyên giá trị cũ', async () => {
      const user = makeUser({ fullName: 'Tên Cũ', phoneNumber: '0900000000' });
      userRepo.findOne.mockResolvedValue(user);

      await service.updateUser(user.id, { role: 'VIEWER' } as any);

      expect(user.fullName).toBe('Tên Cũ');
      expect(user.phoneNumber).toBe('0900000000');
      expect(user.role).toBe('VIEWER');
    });
  });

  describe('seedDefaultAdmin', () => {
    it('đã có ADMIN thì không tạo thêm', async () => {
      service = build();
      userRepo.count.mockResolvedValue(1);

      await service.seedDefaultAdmin();

      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('dùng ADMIN_BOOTSTRAP_PASSWORD khi đủ 8 ký tự', async () => {
      service = build({ ADMIN_BOOTSTRAP_PASSWORD: 'super-secret-pass' });
      userRepo.count.mockResolvedValue(0);

      await service.seedDefaultAdmin();

      const created = userRepo.create.mock.calls[0][0];
      expect(created.mustChangePassword).toBe(false);
      await expect(bcrypt.compare('super-secret-pass', created.passwordHash)).resolves.toBe(true);
    });

    it.each<[string | undefined, string]>([
      ['short', 'ngắn hơn 8 ký tự'],
      ['', 'rỗng'],
      [undefined, 'không cấu hình'],
    ])(
      'password %p (%s) → sinh ngẫu nhiên và bắt buộc đổi',
      async (bootstrapPassword) => {
        service = build({ ADMIN_BOOTSTRAP_PASSWORD: bootstrapPassword });
        userRepo.count.mockResolvedValue(0);

        await service.seedDefaultAdmin();

        expect(userRepo.create.mock.calls[0][0].mustChangePassword).toBe(true);
      },
    );

    it('tài khoản seed là ADMIN đã kích hoạt', async () => {
      service = build({ ADMIN_BOOTSTRAP_PASSWORD: 'super-secret-pass' });
      userRepo.count.mockResolvedValue(0);

      await service.seedDefaultAdmin();

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin', role: 'ADMIN', status: 'ACTIVE' }),
      );
    });
  });

  describe('sendApprovalEmail', () => {
    it('không có email thì bỏ qua', async () => {
      await service.sendApprovalEmail(makeUser({ email: '' }));
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('SMTP chưa cấu hình thì no-op, không ném lỗi', async () => {
      service = build({ SMTP_USER: '', SMTP_PASS: '' });
      await expect(service.sendApprovalEmail(makeUser())).resolves.toBeUndefined();
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('cấu hình đủ thì gửi tới đúng địa chỉ', async () => {
      service = build({ SMTP_USER: 'bot@example.test', SMTP_PASS: 'real-password' });

      await service.sendApprovalEmail(makeUser({ email: 'target@example.test' }));

      expect(sendMailMock).toHaveBeenCalled();
      expect(lastSentMail().to).toContain('target@example.test');
    });

    // Tên người dùng do người dùng tự nhập, đi thẳng vào HTML email —
    // phải escape, nếu không email client sẽ render thẻ chèn vào.
    it('escape HTML trong dữ liệu người dùng nhập', async () => {
      service = build({ SMTP_USER: 'bot@example.test', SMTP_PASS: 'real-password' });

      await service.sendApprovalEmail(
        makeUser({ fullName: '<img src=x onerror=alert(1)>' }),
      );

      const html = lastSentMail().html;
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img src=x');
    });
  });

  describe('không rò rỉ passwordHash', () => {
    it('getProfile', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      expectNoPasswordHash(await service.getProfile('user-uuid-1'));
    });

    it('findAllUsers', async () => {
      userRepo.find.mockResolvedValue([makeUser(), makeAdmin()]);
      (await service.findAllUsers()).forEach(expectNoPasswordHash);
    });

    it('updateProfile', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      expectNoPasswordHash(await service.updateProfile('user-uuid-1', { fullName: 'X' } as any));
    });
  });
});
