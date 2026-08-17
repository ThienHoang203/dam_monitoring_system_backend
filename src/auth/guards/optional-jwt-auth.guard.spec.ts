import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { makeOperator } from '../../../test/helpers/factories';

/**
 * Dùng kèm @Public() trên các endpoint đọc: khách vãng lai xem được dữ liệu toàn hệ thống,
 * còn OPERATOR đã đăng nhập thì bị thu hẹp về đập được phân công.
 * Điểm khác biệt duy nhất so với JwtAuthGuard: KHÔNG ném lỗi khi thiếu token.
 */
describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('không có token → trả null thay vì ném lỗi', () => {
    expect(guard.handleRequest(null, null)).toBeNull();
    expect(guard.handleRequest(null, undefined)).toBeNull();
  });

  it('token hỏng/hết hạn → vẫn trả null, request đi tiếp như khách', () => {
    expect(guard.handleRequest(new Error('jwt expired'), null)).toBeNull();
    expect(guard.handleRequest(new Error('invalid signature'), undefined)).toBeNull();
  });

  it('token hợp lệ → trả user để controller áp dụng lọc theo đập', () => {
    const user = makeOperator('DAM-002');
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('có lỗi nhưng vẫn có user → ưu tiên lỗi, trả null', () => {
    expect(guard.handleRequest(new Error('boom'), makeOperator())).toBeNull();
  });
});
