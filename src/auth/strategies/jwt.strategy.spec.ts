import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { createConfigService } from '../../../test/helpers/exec-context';
import { createMockRepo, MockRepo } from '../../../test/helpers/mock-repo';
import { makeUser } from '../../../test/helpers/factories';

const VALID_SECRET = 'test-secret-key-at-least-32-characters-long-xx';

describe('JwtStrategy', () => {
  let userRepo: MockRepo;

  // Không dùng tham số mặc định: `build(undefined)` phải thật sự truyền undefined
  // xuống ConfigService, chứ không bị default param thay bằng secret hợp lệ.
  const build = (...args: [secret?: string | undefined]) =>
    new JwtStrategy(
      createConfigService({ JWT_SECRET: args.length ? args[0] : VALID_SECRET }),
      userRepo as any,
    );

  beforeEach(() => {
    userRepo = createMockRepo();
  });

  describe('ràng buộc JWT_SECRET', () => {
    it('ném lỗi khi thiếu secret', () => {
      expect(() => build(undefined as any)).toThrow(/JWT_SECRET bắt buộc/);
    });

    it('ném lỗi khi secret ngắn hơn 32 ký tự', () => {
      expect(() => build('a'.repeat(31))).toThrow(/>= 32 ký tự/);
    });

    it('khởi tạo được với secret đủ 32 ký tự', () => {
      expect(() => build('a'.repeat(32))).not.toThrow();
    });
  });

  describe('validate — kiểm tra lại DB mỗi request', () => {
    // Đây là cơ chế thu hồi quyền tức thì: token còn hạn nhưng tài khoản bị khoá
    // thì request tiếp theo đã bị chặn, không phải chờ token hết hạn sau 1 ngày.
    it('tài khoản không còn tồn tại → Unauthorized', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(build().validate({ sub: 'deleted-user' })).rejects.toThrow(UnauthorizedException);
    });

    it.each(['PENDING_APPROVAL', 'SUSPENDED'])(
      'tài khoản trạng thái %s → Unauthorized dù token còn hạn',
      async (status) => {
        userRepo.findOne.mockResolvedValue(makeUser({ status: status as any }));
        await expect(build().validate({ sub: 'user-uuid-1' })).rejects.toThrow(
          UnauthorizedException,
        );
      },
    );

    it('tài khoản ACTIVE → trả nguyên entity User cho req.user', async () => {
      const user = makeUser({ status: 'ACTIVE' });
      userRepo.findOne.mockResolvedValue(user);

      await expect(build().validate({ sub: user.id })).resolves.toBe(user);
      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: user.id } });
    });

    it('tra cứu theo payload.sub, không tin các trường khác trong token', async () => {
      const user = makeUser({ role: 'OPERATOR' });
      userRepo.findOne.mockResolvedValue(user);

      // Token khai role ADMIN nhưng DB nói OPERATOR — DB là nguồn sự thật.
      const result = await build().validate({ sub: user.id, role: 'ADMIN' });
      expect(result.role).toBe('OPERATOR');
    });
  });
});
