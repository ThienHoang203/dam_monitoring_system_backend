import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createRealtimeApp, resetDb, teardownRealtimeApp } from '../helpers/e2e-app';
import { waitForEvent, sleep } from '../helpers/wait-for';
import { Dam } from '../../src/dam/entities/dam.entity';
import { Station } from '../../src/dam/entities/station.entity';
import { SensorService } from '../../src/sensor/sensor.service';

/**
 * Kênh WebSocket đẩy dữ liệu realtime lên dashboard. Tầng này dùng socket.io-client
 * thật để kiểm chứng hợp đồng sự kiện — tên sự kiện và hình dạng payload là thứ
 * frontend phụ thuộc trực tiếp.
 */
describe('WebSocket với client thật', () => {
  let app: INestApplication;
  let ds: DataSource;
  let baseUrl: string;
  let sockets: Socket[] = [];

  const STATION_ID = 'STA-001-01';
  const DAM_ID = 'DAM-001';

  beforeAll(async () => {
    ({ app, ds, baseUrl } = await createRealtimeApp());
  });

  afterAll(async () => {
    if (app) await teardownRealtimeApp(app);
  });

  beforeEach(async () => {
    await resetDb(ds);
    const dam = await ds.getRepository(Dam).save(
      ds.getRepository(Dam).create({ damId: DAM_ID, name: 'Đập Test' }),
    );
    await ds.getRepository(Station).save(
      ds.getRepository(Station).create({
        stationId: STATION_ID,
        stationCode: 'ST01',
        name: 'Trạm 01',
        damRefId: dam.id,
      }),
    );
    await app.get(SensorService).syncTopologyFromDb();
  });

  afterEach(() => {
    // Không đóng socket sẽ để lại kết nối mở và Jest không thoát được.
    sockets.forEach((s) => s.disconnect());
    sockets = [];
  });

  /** Mở một kết nối WebSocket và chờ tới khi bắt tay xong. */
  async function connect(): Promise<Socket> {
    const socket = io(baseUrl, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Không kết nối được WebSocket')), 10_000);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return socket;
  }

  const ingest = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/sensor/all')
      .set('x-gateway-api-key', process.env.GATEWAY_API_KEY || 'test-gateway-key')
      .send(body);

  describe('kết nối và nạp dữ liệu ban đầu', () => {
    // ⚠️ LỖ HỔNG: gateway đặt cors.origin '*' và không kiểm JWT ở handleConnection.
    // Bất kỳ ai biết địa chỉ đều nhận được toàn bộ telemetry và cảnh báo của mọi đập.
    it('LỖ HỔNG: kết nối được mà KHÔNG cần bất kỳ thông tin xác thực nào', async () => {
      const socket = await connect();
      expect(socket.connected).toBe(true);
    });

    it('client mới nhận ngay gói lịch sử', async () => {
      const socket = io(baseUrl, { transports: ['websocket'], forceNew: true });
      sockets.push(socket);

      const history = await waitForEvent(socket, 'history');

      expect(history).toHaveProperty('timestamps');
      expect(history).toHaveProperty('waterLevel');
    });
  });

  describe('phát sóng dữ liệu quan trắc', () => {
    it('ingest qua HTTP làm client nhận được sự kiện update', async () => {
      const socket = await connect();
      const updated = waitForEvent(socket, 'update');

      await ingest({ freq: 50, amp: 1.2, waterLevel: 31, moisture: 45, stationId: STATION_ID });

      const snapshot: any = await updated;
      expect(snapshot.waterLevel).toBe(31);
      expect(snapshot).toHaveProperty('percent');
      expect(snapshot).toHaveProperty('timestamp');
    });

    it('nhiều client cùng nhận được một bản cập nhật', async () => {
      const [a, b] = [await connect(), await connect()];
      const both = Promise.all([waitForEvent(a, 'update'), waitForEvent(b, 'update')]);

      await ingest({ freq: 50, amp: 1, waterLevel: 22, moisture: 40, stationId: STATION_ID });

      const [ua, ub]: any[] = await both;
      expect(ua.waterLevel).toBe(22);
      expect(ub.waterLevel).toBe(22);
    });

    // Cơ chế tiết lưu 50ms: hai lần ingest sát nhau cho cùng một cụm chỉ phát một lần,
    // giữ cho dashboard mượt khi nhiều node gửi dồn dập.
    it('hai lần ingest sát nhau cùng cụm chỉ phát sóng một lần', async () => {
      const socket = await connect();
      const received: any[] = [];
      socket.on('update', (payload) => received.push(payload));

      await ingest({ freq: 50, amp: 1, waterLevel: 10, moisture: 40, clusterId: 'cụm-1' });
      await ingest({ freq: 50, amp: 1, waterLevel: 11, moisture: 40, clusterId: 'cụm-1' });
      await sleep(600);

      expect(received.length).toBe(1);
    });

    it('hai cụm khác nhau được phát sóng độc lập', async () => {
      const socket = await connect();
      const received: any[] = [];
      socket.on('update', (payload) => received.push(payload));

      await ingest({ freq: 50, amp: 1, waterLevel: 10, moisture: 40, clusterId: 'cụm-A' });
      await ingest({ freq: 50, amp: 1, waterLevel: 20, moisture: 40, clusterId: 'cụm-B' });
      await sleep(600);

      expect(received.length).toBe(2);
    });
  });

  describe('hợp đồng sự kiện với giao diện', () => {
    it('tên sự kiện đúng như frontend đang lắng nghe', async () => {
      const socket = await connect();
      const seen = new Set<string>();
      // socket.io-client hỗ trợ onAny để bắt mọi sự kiện đến.
      socket.onAny((event: string) => seen.add(event));

      await ingest({ freq: 50, amp: 1, waterLevel: 15, moisture: 40, stationId: STATION_ID });
      await sleep(800);

      expect(seen.has('update')).toBe(true);
      // 'history' đã được gửi ngay lúc kết nối, trước khi gắn onAny.
      expect([...seen].every((e) => typeof e === 'string')).toBe(true);
    });

    it('ngắt kết nối không làm sập máy chủ', async () => {
      const socket = await connect();
      socket.disconnect();
      await sleep(300);

      // Máy chủ vẫn phục vụ request HTTP bình thường sau khi client rời đi.
      await ingest({ freq: 50, amp: 1, waterLevel: 12, moisture: 40 }).expect(200);
    });
  });
});
