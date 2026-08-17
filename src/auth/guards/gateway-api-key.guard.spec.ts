import { UnauthorizedException } from '@nestjs/common';
import { GatewayApiKeyGuard } from './gateway-api-key.guard';
import { createExecutionContext, createConfigService } from '../../../test/helpers/exec-context';

/**
 * Guard bảo vệ các endpoint mà Gateway/Jetson TX2 gọi vào:
 *   POST /sensor/all, PUT /sensor/alarms/:id/ai-result,
 *   POST /api/evidence/upload, GET /api/gateway/:id/config
 */
describe('GatewayApiKeyGuard', () => {
  const guardWith = (values: Record<string, any>) =>
    new GatewayApiKeyGuard(createConfigService(values));

  describe('khi GATEWAY_API_KEY chưa được cấu hình', () => {
    // ⚠️ FAIL-OPEN CÓ CHỦ Ý trong code hiện tại: không cấu hình key nghĩa là
    // MỌI endpoint ingest mở công khai. Test khoá hành vi này lại để việc đổi
    // sang fail-closed là một thay đổi có ý thức, không phải vô tình.
    it.each<[string | undefined, string]>([
      [undefined, 'không set'],
      ['', 'chuỗi rỗng'],
      ['   ', 'toàn khoảng trắng'],
    ])('cho qua mọi request khi key %p (%s)', (key) => {
      const guard = guardWith({ GATEWAY_API_KEY: key });
      expect(guard.canActivate(createExecutionContext())).toBe(true);
    });
  });

  describe('khi GATEWAY_API_KEY đã được cấu hình', () => {
    const guard = () => guardWith({ GATEWAY_API_KEY: 'secret-key' });

    it('chấp nhận key qua header x-gateway-api-key', () => {
      const ctx = createExecutionContext({ headers: { 'x-gateway-api-key': 'secret-key' } });
      expect(guard().canActivate(ctx)).toBe(true);
    });

    // ⚠️ Query string bị ghi vào access log của reverse proxy và lịch sử trình duyệt.
    it('chấp nhận key qua query string (bề mặt rò rỉ — key lộ trong log)', () => {
      const ctx = createExecutionContext({ query: { apiKey: 'secret-key' } });
      expect(guard().canActivate(ctx)).toBe(true);
    });

    it('chấp nhận key qua body', () => {
      const ctx = createExecutionContext({ body: { apiKey: 'secret-key' } });
      expect(guard().canActivate(ctx)).toBe(true);
    });

    it('từ chối khi key sai', () => {
      const ctx = createExecutionContext({ headers: { 'x-gateway-api-key': 'wrong-key' } });
      expect(() => guard().canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('từ chối khi thiếu key hoàn toàn', () => {
      expect(() => guard().canActivate(createExecutionContext())).toThrow(UnauthorizedException);
    });

    it('không crash khi request thiếu query/body', () => {
      const ctx = createExecutionContext({ headers: {}, query: undefined, body: undefined });
      expect(() => guard().canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('thông báo lỗi chỉ rõ header cần gửi', () => {
      expect(() => guard().canActivate(createExecutionContext())).toThrow(
        /x-gateway-api-key/,
      );
    });
  });
});
