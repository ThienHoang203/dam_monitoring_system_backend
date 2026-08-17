import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { createExecutionContext, createReflector } from '../../../test/helpers/exec-context';
import { makeAdmin } from '../../../test/helpers/factories';

/**
 * JwtAuthGuard là APP_GUARD đầu tiên — mọi route đều xác thực theo mặc định,
 * trừ khi có @Public().
 */
describe('JwtAuthGuard', () => {
  // AuthGuard('jwt') trả về một mixin class; prototype cha của JwtAuthGuard chính là nó.
  const basePrototype = Object.getPrototypeOf(JwtAuthGuard.prototype);
  let superCanActivate: jest.SpyInstance;

  beforeEach(() => {
    superCanActivate = jest
      .spyOn(basePrototype, 'canActivate')
      .mockReturnValue(true as any);
  });

  afterEach(() => superCanActivate.mockRestore());

  describe('bypass @Public()', () => {
    it('route @Public() được cho qua mà KHÔNG chạy xác thực passport', () => {
      const guard = new JwtAuthGuard(createReflector({ isPublic: true }));
      expect(guard.canActivate(createExecutionContext())).toBe(true);
      expect(superCanActivate).not.toHaveBeenCalled();
    });

    it('route không @Public() thì đi xuống passport', () => {
      const guard = new JwtAuthGuard(createReflector({ isPublic: false }));
      guard.canActivate(createExecutionContext());
      expect(superCanActivate).toHaveBeenCalledTimes(1);
    });

    // ⚠️ Constructor khai `reflector?: Reflector` (optional). Khi guard được khởi tạo
    // thủ công qua @UseGuards(JwtAuthGuard) mà không có DI cấp reflector, nhánh
    // kiểm tra @Public bị bỏ qua HOÀN TOÀN và im lặng — route công khai bỗng
    // yêu cầu đăng nhập. Khoá hành vi này lại để không ai vô tình dựa vào nó.
    it('KHÔNG có Reflector → @Public() ngừng hoạt động (không báo lỗi)', () => {
      const guard = new JwtAuthGuard();
      guard.canActivate(createExecutionContext());
      expect(superCanActivate).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleRequest', () => {
    it('trả user khi xác thực thành công', () => {
      const guard = new JwtAuthGuard(createReflector({}));
      const user = makeAdmin();
      expect(guard.handleRequest(null, user)).toBe(user);
    });

    it('không có user → Unauthorized với thông báo tiếng Việt', () => {
      const guard = new JwtAuthGuard(createReflector({}));
      expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
      expect(() => guard.handleRequest(null, undefined)).toThrow(
        'Phiên đăng nhập hết hạn hoặc không hợp lệ',
      );
    });

    it('ưu tiên ném đúng lỗi gốc từ passport thay vì lỗi chung', () => {
      const guard = new JwtAuthGuard(createReflector({}));
      const original = new Error('jwt expired');
      expect(() => guard.handleRequest(original, makeAdmin())).toThrow(original);
    });
  });
});
