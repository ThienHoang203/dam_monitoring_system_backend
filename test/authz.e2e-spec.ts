import { INestApplication } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { createE2EApp, resetDb } from './helpers/e2e-app';
import { User, UserRole } from '../src/auth/entities/user.entity';
import { Dam } from '../src/dam/entities/dam.entity';
import { Station } from '../src/dam/entities/station.entity';
import { Gateway } from '../src/gateway/entities/gateway.entity';
import { Camera } from '../src/camera/entities/camera.entity';
import { signToken, bearer } from './helpers/auth';

/**
 * Ma trận phân quyền chạy qua HTTP thật — đi đủ chuỗi JwtAuthGuard → RolesGuard
 * và phần kiểm tra assignedDamId viết tay trong từng controller.
 */
describe('Phân quyền (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => ReturnType<typeof request>;

  let tokens: Record<'admin' | 'operatorA' | 'viewer', string>;
  let damA: Dam;
  let damB: Dam;
  let gatewayOfB: Gateway;
  let cameraOfB: Camera;

  beforeAll(async () => {
    ({ app, ds } = await createE2EApp());
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDb(ds);

    const userRepo: Repository<User> = ds.getRepository(User);
    const mkUser = async (username: string, role: UserRole, assignedDamId?: string) =>
      userRepo.save(
        userRepo.create({
          email: `${username}@example.test`,
          username,
          passwordHash: 'không-dùng-tới-trong-bài-test-này',
          fullName: username,
          role,
          status: 'ACTIVE',
          assignedDamId,
        }),
      );

    const admin = await mkUser('admin1', 'ADMIN');
    const operatorA = await mkUser('operatorA', 'OPERATOR', 'DAM-001');
    const viewer = await mkUser('viewer1', 'VIEWER');

    tokens = {
      admin: signToken({ sub: admin.id, role: 'ADMIN' }),
      operatorA: signToken({ sub: operatorA.id, role: 'OPERATOR', assignedDamId: 'DAM-001' }),
      viewer: signToken({ sub: viewer.id, role: 'VIEWER' }),
    };

    // Hai đập: A là của operatorA, B là đập "ngoài phạm vi".
    const damRepo = ds.getRepository(Dam);
    damA = await damRepo.save(damRepo.create({ damId: 'DAM-001', name: 'Đập A' }));
    damB = await damRepo.save(damRepo.create({ damId: 'DAM-002', name: 'Đập B' }));

    const stationRepo = ds.getRepository(Station);
    const stationB = await stationRepo.save(
      stationRepo.create({
        stationId: 'STA-002-01',
        stationCode: 'ST02',
        name: 'Trạm của đập B',
        damRefId: damB.id,
      }),
    );

    const gatewayRepo = ds.getRepository(Gateway);
    gatewayOfB = await gatewayRepo.save(
      gatewayRepo.create({
        gatewayId: 'GTW-ST02-TX2A',
        name: 'Jetson đập B',
        macAddress: '02:BB:BB:BB:BB:01',
        stationRefId: stationB.id,
      }),
    );

    const cameraRepo = ds.getRepository(Camera);
    cameraOfB = await cameraRepo.save(
      cameraRepo.create({
        cameraId: 'CAM-CSI-ST02-01',
        cameraType: 'CSI',
        name: 'Camera đập B',
        gatewayRefId: gatewayOfB.id,
      }),
    );
  });

  describe('endpoint chỉ dành cho quản trị viên', () => {
    it.each<[string, number]>([
      ['admin', 200],
      ['operatorA', 403],
      ['viewer', 403],
    ])('GET /users với vai trò %s → %i', async (who, status) => {
      await http()
        .get('/users')
        .set(bearer(tokens[who as keyof typeof tokens]))
        .expect(status);
    });

    it('GET /users khi chưa đăng nhập → 401', async () => {
      await http().get('/users').expect(401);
    });

    it.each<[string, number]>([
      ['admin', 201],
      ['operatorA', 403],
      ['viewer', 403],
    ])('POST /dams với vai trò %s → %i', async (who, status) => {
      await http()
        .post('/dams')
        .set(bearer(tokens[who as keyof typeof tokens]))
        .send({ name: `Đập mới ${who}` })
        .expect(status);
    });

    it('GET /audit-logs chỉ dành cho ADMIN', async () => {
      await http().get('/audit-logs').set(bearer(tokens.admin)).expect(200);
      await http().get('/audit-logs').set(bearer(tokens.operatorA)).expect(403);
    });
  });

  describe('thu hẹp phạm vi theo đập của OPERATOR', () => {
    it('GET /dams chỉ trả về đập được phân công', async () => {
      const res = await http().get('/dams').set(bearer(tokens.operatorA)).expect(200);

      expect(res.body.dams).toHaveLength(1);
      expect(res.body.dams[0].damId).toBe('DAM-001');
    });

    it('GET /dams/:id của đập khác → 403', async () => {
      await http().get('/dams/DAM-002').set(bearer(tokens.operatorA)).expect(403);
    });

    it('GET /stations bị ép về đập của mình dù query hỏi đập khác', async () => {
      const res = await http()
        .get('/stations?damId=DAM-002')
        .set(bearer(tokens.operatorA))
        .expect(200);

      expect(res.body.stations).toHaveLength(0); // đập A chưa có trạm nào
    });

    it('GET /api/gateways không rò rỉ gateway của đập khác', async () => {
      const res = await http()
        .get('/api/gateways?damId=DAM-002')
        .set(bearer(tokens.operatorA))
        .expect(200);

      expect(res.body.gateways).toHaveLength(0);
    });

    it('DELETE gateway của đập khác → 403', async () => {
      await http()
        .delete(`/api/gateways/${gatewayOfB.gatewayId}`)
        .set(bearer(tokens.operatorA))
        .expect(403);
    });

    it('ADMIN không bị thu hẹp phạm vi', async () => {
      const res = await http().get('/dams').set(bearer(tokens.admin)).expect(200);
      expect(res.body.dams).toHaveLength(2);
    });
  });

  describe('lỗ hổng phân quyền đã xác nhận qua HTTP', () => {
    // ⚠️ findById của GatewayController không kiểm assignedDamId, khác hẳn
    // findAll/create/update/delete cùng file.
    it('LỖ HỔNG: OPERATOR đọc được gateway của đập khác qua :id', async () => {
      const res = await http()
        .get(`/api/gateways/${gatewayOfB.gatewayId}`)
        .set(bearer(tokens.operatorA))
        .expect(200);

      expect(res.body.gateway.gatewayId).toBe('GTW-ST02-TX2A');
    });

    // ⚠️ CameraController không có bất kỳ kiểm tra theo đập nào.
    it('LỖ HỔNG: OPERATOR thấy camera của mọi đập', async () => {
      const res = await http().get('/api/cameras').set(bearer(tokens.operatorA)).expect(200);

      expect(res.body.cameras.map((c: any) => c.cameraId)).toContain('CAM-CSI-ST02-01');
    });

    it('LỖ HỔNG: OPERATOR sửa được camera của đập khác', async () => {
      await http()
        .put(`/api/cameras/${cameraOfB.cameraId}`)
        .set(bearer(tokens.operatorA))
        .send({ name: 'Bị sửa bởi người ngoài phạm vi' })
        .expect(200);
    });

    // ⚠️ Các endpoint đọc dữ liệu quan trắc là @Public hoàn toàn.
    it.each(['/sensor/latest', '/sensor/thresholds', '/sensor/status-history'])(
      'LỖ HỔNG: %s truy cập được khi chưa đăng nhập',
      async (path) => {
        await http().get(path).expect(200);
      },
    );
  });

  describe('ValidationPipe toàn cục', () => {
    it('field lạ trong body → 400', async () => {
      await http()
        .post('/dams')
        .set(bearer(tokens.admin))
        .send({ name: 'Đập', truongLa: 'giá trị' })
        .expect(400);
    });

    it('mã đập sai chuẩn đặt tên → 400', async () => {
      await http()
        .post('/dams')
        .set(bearer(tokens.admin))
        .send({ name: 'Đập', damId: 'DAM-1' })
        .expect(400);
    });
  });

  describe('GatewayApiKeyGuard qua HTTP', () => {
    // .env.test đặt GATEWAY_API_KEY=test-gateway-key nên nhánh kiểm tra được bật.
    it('thiếu khoá → 401', async () => {
      await http()
        .post('/sensor/all')
        .send({ freq: 50, amp: 1.2, waterLevel: 30, moisture: 45 })
        .expect(401);
    });

    it('khoá đúng qua header → 200', async () => {
      await http()
        .post('/sensor/all')
        .set('x-gateway-api-key', 'test-gateway-key')
        .send({ freq: 50, amp: 1.2, waterLevel: 30, moisture: 45 })
        .expect(200);
    });

    it('khoá sai → 401', async () => {
      await http()
        .post('/sensor/all')
        .set('x-gateway-api-key', 'khoa-sai')
        .send({ freq: 50, amp: 1.2, waterLevel: 30, moisture: 45 })
        .expect(401);
    });

    // ⚠️ Khoá đi qua query string sẽ bị ghi vào access log của reverse proxy.
    it('LỖ HỔNG: khoá qua query string cũng được chấp nhận', async () => {
      await http()
        .post('/sensor/all?apiKey=test-gateway-key')
        .send({ freq: 50, amp: 1.2, waterLevel: 30, moisture: 45 })
        .expect(200);
    });
  });

  describe('chặn path traversal ở proxy ảnh', () => {
    it.each([
      '/sensor/images/..%2F..%2Fetc%2Fpasswd',
      '/sensor/images/%2Fetc/passwd',
      '/sensor/images/a%5Cb.jpg',
    ])('%s → 400', async (path) => {
      await http().get(path).expect(400);
    });
  });
});
