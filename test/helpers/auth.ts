/**
 * Helper tạo JWT và gắn credential cho request trong E2E test.
 *
 * JwtStrategy đọc token từ hai nguồn theo thứ tự: header `Authorization: Bearer`
 * rồi tới cookie `access_token`. Cả hai đều cần được test.
 */
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../../src/auth/entities/user.entity';

export interface TokenPayload {
  sub: string;
  username: string;
  email: string;
  role: UserRole;
  assignedDamId?: string | null;
}

function jwt(): JwtService {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET phải có ít nhất 32 ký tự — kiểm tra .env.test đã được nạp chưa.');
  }
  return new JwtService({ secret, signOptions: { expiresIn: '1d' } });
}

export function signToken(payload: Partial<TokenPayload> & { sub: string }): string {
  return jwt().sign({
    username: 'testuser',
    email: 'testuser@example.test',
    role: 'OPERATOR',
    assignedDamId: null,
    ...payload,
  });
}

/** Token ký bằng secret khác — dùng để test request bị từ chối. */
export function signTokenWithWrongSecret(payload: Partial<TokenPayload> & { sub: string }): string {
  const other = new JwtService({
    secret: 'a-completely-different-secret-key-32-chars',
    signOptions: { expiresIn: '1d' },
  });
  return other.sign({ username: 'x', email: 'x@example.test', role: 'ADMIN', ...payload });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const cookie = (token: string) => ({ Cookie: `access_token=${token}` });
