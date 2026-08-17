import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { createExecutionContext, createReflector } from '../../../test/helpers/exec-context';
import { makeAdmin, makeOperator, makeViewer } from '../../../test/helpers/factories';

/**
 * RolesGuard được đăng ký làm APP_GUARD toàn cục (app.module.ts), chạy sau JwtAuthGuard.
 */
describe('RolesGuard', () => {
  describe('route công khai / không khai báo quyền', () => {
    it('@Public() được cho qua ngay, không cần user', () => {
      const guard = new RolesGuard(createReflector({ isPublic: true }));
      expect(guard.canActivate(createExecutionContext())).toBe(true);
    });

    it('không có metadata @Roles → cho qua', () => {
      const guard = new RolesGuard(createReflector({}));
      expect(guard.canActivate(createExecutionContext({ user: makeViewer() }))).toBe(true);
    });

    it('@Roles() rỗng → cho qua', () => {
      const guard = new RolesGuard(createReflector({ roles: [] }));
      expect(guard.canActivate(createExecutionContext({ user: makeViewer() }))).toBe(true);
    });
  });

  describe('route có yêu cầu quyền', () => {
    it('chưa đăng nhập → Forbidden', () => {
      const guard = new RolesGuard(createReflector({ roles: ['ADMIN'] }));
      expect(() => guard.canActivate(createExecutionContext())).toThrow(ForbiddenException);
      expect(() => guard.canActivate(createExecutionContext())).toThrow('Bạn chưa đăng nhập');
    });

    // ADMIN short-circuit: bỏ qua hoàn toàn danh sách roles. Đây là quyết định
    // thiết kế, không phải bug — nhưng nghĩa là mọi endpoint @Roles đều mở cho ADMIN.
    it('ADMIN đi qua MỌI @Roles, kể cả khi không nằm trong danh sách', () => {
      const guard = new RolesGuard(createReflector({ roles: ['OPERATOR'] }));
      expect(guard.canActivate(createExecutionContext({ user: makeAdmin() }))).toBe(true);
    });

    it('OPERATOR đi qua @Roles có chứa OPERATOR', () => {
      const guard = new RolesGuard(createReflector({ roles: ['ADMIN', 'OPERATOR'] }));
      expect(guard.canActivate(createExecutionContext({ user: makeOperator() }))).toBe(true);
    });

    it('OPERATOR bị chặn ở @Roles chỉ cho ADMIN', () => {
      const guard = new RolesGuard(createReflector({ roles: ['ADMIN'] }));
      expect(() => guard.canActivate(createExecutionContext({ user: makeOperator() }))).toThrow(
        'Bạn không có quyền thực hiện thao tác này',
      );
    });

    it('VIEWER bị chặn ở mọi thao tác ghi', () => {
      const guard = new RolesGuard(createReflector({ roles: ['ADMIN', 'OPERATOR'] }));
      expect(() => guard.canActivate(createExecutionContext({ user: makeViewer() }))).toThrow(
        ForbiddenException,
      );
    });

    it('role lạ ngoài 3 giá trị hợp lệ → Forbidden', () => {
      const guard = new RolesGuard(createReflector({ roles: ['ADMIN'] }));
      const rogue = makeOperator('DAM-001', { role: 'ROOT' as any });
      expect(() => guard.canActivate(createExecutionContext({ user: rogue }))).toThrow(
        ForbiddenException,
      );
    });
  });

  it('@Public() được kiểm TRƯỚC @Roles — public thắng', () => {
    const guard = new RolesGuard(createReflector({ isPublic: true, roles: ['ADMIN'] }));
    expect(guard.canActivate(createExecutionContext({ user: makeViewer() }))).toBe(true);
  });
});
