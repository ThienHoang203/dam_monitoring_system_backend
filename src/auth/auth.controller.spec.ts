import { AuthController } from './auth.controller';
import { makeUser } from '../../test/helpers/factories';

describe('AuthController', () => {
  let authService: any;
  let controller: AuthController;
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(() => {
    authService = {
      register: jest.fn().mockResolvedValue({ message: 'ok', user: {} }),
      login: jest.fn().mockResolvedValue({ accessToken: 'jwt.token', user: {} }),
      getProfile: jest.fn().mockResolvedValue({}),
      updateProfile: jest.fn().mockResolvedValue({}),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    controller = new AuthController(authService);
  });

  describe('POST /auth/login — cookie phiên đăng nhập', () => {
    it('đặt token vào cookie HttpOnly để JavaScript không đọc được', async () => {
      await controller.login({ usernameOrEmail: 'admin', password: 'x' } as any, res as any);

      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'jwt.token',
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('đặt sameSite=lax để giảm rủi ro CSRF', async () => {
      await controller.login({ usernameOrEmail: 'admin', password: 'x' } as any, res as any);
      expect(res.cookie.mock.calls[0][2].sameSite).toBe('lax');
    });

    // ⚠️ secure=false nghĩa là cookie được gửi qua cả kết nối HTTP không mã hoá.
    // Chấp nhận được khi phát triển; phải bật lên trước khi chạy thật sau HTTPS.
    it('secure=false — cookie đi qua cả HTTP (cần bật lên khi triển khai HTTPS)', async () => {
      await controller.login({ usernameOrEmail: 'admin', password: 'x' } as any, res as any);
      expect(res.cookie.mock.calls[0][2].secure).toBe(false);
    });

    // ⚠️ LỖ HỔNG: cookie sống 7 ngày trong khi JWT chỉ có hiệu lực 1 ngày
    // (AuthModule đặt expiresIn '1d'). Sau ngày đầu tiên, trình duyệt vẫn gửi
    // cookie nhưng mọi request đều 401 — người dùng thấy như bị đăng xuất ngẫu nhiên.
    it('LỖ HỔNG: cookie hết hạn sau 7 ngày nhưng token chỉ sống 1 ngày', async () => {
      await controller.login({ usernameOrEmail: 'admin', password: 'x' } as any, res as any);

      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const ONE_DAY = 24 * 60 * 60 * 1000;
      expect(res.cookie.mock.calls[0][2].maxAge).toBe(SEVEN_DAYS);
      expect(res.cookie.mock.calls[0][2].maxAge).toBeGreaterThan(ONE_DAY);
    });

    it('vẫn trả token trong body để client lưu dạng Bearer nếu muốn', async () => {
      const result = await controller.login(
        { usernameOrEmail: 'admin', password: 'x' } as any,
        res as any,
      );
      expect(result.accessToken).toBe('jwt.token');
    });

    it('đăng nhập thất bại thì không đặt cookie', async () => {
      authService.login.mockRejectedValue(new Error('Sai mật khẩu'));

      await expect(
        controller.login({ usernameOrEmail: 'admin', password: 'x' } as any, res as any),
      ).rejects.toThrow();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/logout', () => {
    it('xoá cookie phiên đăng nhập', async () => {
      await controller.logout(res as any);
      expect(res.clearCookie).toHaveBeenCalledWith('access_token');
    });

    // Endpoint là @Public: người dùng có token hỏng vẫn phải đăng xuất được.
    it('luôn thành công, không phụ thuộc trạng thái phiên', async () => {
      await expect(controller.logout(res as any)).resolves.toMatchObject({ ok: true });
    });
  });

  describe('GET /auth/me', () => {
    // Lấy id từ req.user (do JwtStrategy nạp từ DB), KHÔNG lấy từ tham số client gửi —
    // nếu không người dùng sẽ đọc được hồ sơ của người khác.
    it('dùng id trong phiên đăng nhập, không tin dữ liệu client', async () => {
      const user = makeUser({ id: 'user-abc' });

      await controller.getMe(user);

      expect(authService.getProfile).toHaveBeenCalledWith('user-abc');
    });
  });

  describe('PUT /auth/me', () => {
    it('chỉ cập nhật hồ sơ của chính người đang đăng nhập', async () => {
      const user = makeUser({ id: 'user-abc' });

      await controller.updateMe(user, { fullName: 'Tên mới' } as any);

      expect(authService.updateProfile).toHaveBeenCalledWith('user-abc', {
        fullName: 'Tên mới',
      });
    });
  });
});
