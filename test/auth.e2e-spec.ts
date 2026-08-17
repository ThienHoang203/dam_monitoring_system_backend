import { INestApplication } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createE2EApp, resetDb } from './helpers/e2e-app';
import { User } from '../src/auth/entities/user.entity';
import { signToken, signTokenWithWrongSecret, bearer, cookie } from './helpers/auth';

/**
 * Luồng xác thực đầu-cuối qua HTTP thật, đi qua đúng ValidationPipe và
 * chuỗi guard toàn cục như production.
 */
describe('Xác thực (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let userRepo: Repository<User>;
  let http: () => ReturnType<typeof request>;

  const PASSWORD = 'password123';
  let passwordHash: string;

  beforeAll(async () => {
    ({ app, ds } = await createE2EApp());
    userRepo = ds.getRepository(User);
    http = () => request(app.getHttpServer());
    passwordHash = await bcrypt.hash(PASSWORD, 10);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  const seedUser = (over: Partial<User> = {}) =>
    userRepo.save(
      userRepo.create({
        email: 'operator@example.test',
        username: 'operator1',
        passwordHash,
        fullName: 'Nguyễn Văn A',
        role: 'OPERATOR',
        status: 'ACTIVE',
        assignedDamId: 'DAM-001',
        ...over,
      }),
    );

  describe('POST /auth/register', () => {
    const validBody = {
      email: 'new@example.test',
      username: 'newuser',
      password: PASSWORD,
      fullName: 'Người Dùng Mới',
    };

    it('đăng ký thành công, không trả về hash mật khẩu', async () => {
      const res = await http().post('/auth/register').send(validBody).expect(201);

      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.user.status).toBe('PENDING_APPROVAL');
      expect(res.body.user.role).toBe('OPERATOR');
    });

    // Đây là test bảo mật quan trọng nhất của bộ e2e: ValidationPipe cấu hình
    // forbidNonWhitelisted nên field lạ bị chặn ngay, không thể tự nâng quyền.
    it('gửi kèm role: ADMIN → 400, chặn leo thang đặc quyền', async () => {
      await http()
        .post('/auth/register')
        .send({ ...validBody, role: 'ADMIN' })
        .expect(400);
    });

    it('gửi kèm status: ACTIVE → 400, không tự duyệt được tài khoản', async () => {
      await http()
        .post('/auth/register')
        .send({ ...validBody, status: 'ACTIVE' })
        .expect(400);
    });

    it('email sai định dạng → 400', async () => {
      await http()
        .post('/auth/register')
        .send({ ...validBody, email: 'khong-phai-email' })
        .expect(400);
    });

    it('email đã dùng → 409', async () => {
      await seedUser({ email: validBody.email, username: 'khac' });
      await http().post('/auth/register').send(validBody).expect(409);
    });
  });

  describe('POST /auth/login', () => {
    it('tài khoản chờ duyệt → 401', async () => {
      await seedUser({ status: 'PENDING_APPROVAL' });

      await http()
        .post('/auth/login')
        .send({ usernameOrEmail: 'operator1', password: PASSWORD })
        .expect(401);
    });

    it('tài khoản bị khoá → 401', async () => {
      await seedUser({ status: 'SUSPENDED' });

      await http()
        .post('/auth/login')
        .send({ usernameOrEmail: 'operator1', password: PASSWORD })
        .expect(401);
    });

    it('sai mật khẩu → 401', async () => {
      await seedUser();

      await http()
        .post('/auth/login')
        .send({ usernameOrEmail: 'operator1', password: 'sai-mat-khau' })
        .expect(401);
    });

    it('đăng nhập thành công → 200 kèm cookie HttpOnly', async () => {
      await seedUser();

      const res = await http()
        .post('/auth/login')
        .send({ usernameOrEmail: 'operator1', password: PASSWORD })
        .expect(200);

      expect(res.body.accessToken).toBeTruthy();
      const setCookie = res.headers['set-cookie'][0];
      expect(setCookie).toContain('access_token=');
      expect(setCookie).toContain('HttpOnly');
    });

    it('đăng nhập được bằng email thay cho tên đăng nhập', async () => {
      await seedUser();

      await http()
        .post('/auth/login')
        .send({ usernameOrEmail: 'operator@example.test', password: PASSWORD })
        .expect(200);
    });
  });

  describe('GET /auth/me — hai kênh mang token', () => {
    it('không có token → 401', async () => {
      await http().get('/auth/me').expect(401);
    });

    it('token qua header Authorization → 200', async () => {
      const user = await seedUser();
      const token = signToken({ sub: user.id, role: 'OPERATOR' });

      const res = await http().get('/auth/me').set(bearer(token)).expect(200);
      expect(res.body.username).toBe('operator1');
    });

    it('token qua cookie access_token → 200', async () => {
      const user = await seedUser();
      const token = signToken({ sub: user.id, role: 'OPERATOR' });

      await http().get('/auth/me').set(cookie(token)).expect(200);
    });

    it('token ký bằng khoá khác → 401', async () => {
      const user = await seedUser();

      await http()
        .get('/auth/me')
        .set(bearer(signTokenWithWrongSecret({ sub: user.id })))
        .expect(401);
    });

    // JwtStrategy truy vấn DB mỗi request nên quyền bị thu hồi có hiệu lực NGAY,
    // không phải chờ token hết hạn sau 1 ngày.
    it('tài khoản bị khoá sau khi phát token → 401 ngay lập tức', async () => {
      const user = await seedUser();
      const token = signToken({ sub: user.id, role: 'OPERATOR' });

      await http().get('/auth/me').set(bearer(token)).expect(200);

      await userRepo.update(user.id, { status: 'SUSPENDED' });

      await http().get('/auth/me').set(bearer(token)).expect(401);
    });

    it('tài khoản bị xoá sau khi phát token → 401', async () => {
      const user = await seedUser();
      const token = signToken({ sub: user.id, role: 'OPERATOR' });

      await userRepo.delete(user.id);

      await http().get('/auth/me').set(bearer(token)).expect(401);
    });
  });

  describe('PUT /auth/me', () => {
    it('sửa được thông tin cá nhân của chính mình', async () => {
      const user = await seedUser();
      const token = signToken({ sub: user.id, role: 'OPERATOR' });

      await http()
        .put('/auth/me')
        .set(bearer(token))
        .send({ fullName: 'Tên Đã Đổi' })
        .expect(200);

      const reloaded = await userRepo.findOneBy({ id: user.id });
      expect(reloaded!.fullName).toBe('Tên Đã Đổi');
    });

    it('cố sửa role của chính mình → 400 (whitelist chặn)', async () => {
      const user = await seedUser();
      const token = signToken({ sub: user.id, role: 'OPERATOR' });

      await http().put('/auth/me').set(bearer(token)).send({ role: 'ADMIN' }).expect(400);

      const reloaded = await userRepo.findOneBy({ id: user.id });
      expect(reloaded!.role).toBe('OPERATOR');
    });
  });
});
