/**
 * Bootstrap AppModule cho E2E test.
 *
 * Ba việc phải xử lý, nếu bỏ qua thì test sẽ treo hoặc dữ liệu lẫn giữa các file:
 *  1. Tắt seeder chạy lúc khởi động (tạo 4 đập, 9 trạm, tài khoản admin) — làm mọi
 *     phép đếm bản ghi trở nên mong manh.
 *  2. Gỡ toàn bộ cron sau app.init() — heartbeat 10 giây và resyncTopology mỗi phút
 *     sẽ ghi DB chen ngang giữa các assertion.
 *  3. Sao y cấu hình toàn cục của main.ts (cookieParser + ValidationPipe).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
// tsconfig.spec.json bật esModuleInterop nên dùng default import (khác main.ts
// vốn chạy dưới cấu hình nodenext).
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { DamService } from '../../src/dam/dam.service';
import { GatewayService } from '../../src/gateway/gateway.service';
import { DownsamplerService } from '../../src/sensor/downsampler.service';

export interface TestApp {
  app: INestApplication;
  moduleRef: TestingModule;
  ds: DataSource;
}

/**
 * Chặn các side effect lúc khởi động. Phải gọi TRƯỚC compile().
 *
 * `keepMqtt: true` dùng cho tầng realtime — ở đó ta CẦN GatewayService kết nối
 * broker thật để kiểm chứng việc đồng bộ cấu hình xuống Jetson TX2.
 */
export function disableBootSideEffects(options: { keepMqtt?: boolean } = {}): void {
  jest.spyOn(AuthService.prototype, 'seedDefaultAdmin').mockResolvedValue(undefined as any);
  jest.spyOn(DamService.prototype, 'seedDefaultData').mockResolvedValue(undefined as any);
  jest.spyOn(DamService.prototype, 'seedDefaultDevices').mockResolvedValue(undefined as any);
  if (!options.keepMqtt) {
    // onModuleInit của GatewayService mở kết nối MQTT thật.
    jest.spyOn(GatewayService.prototype, 'onModuleInit').mockImplementation(() => undefined as any);
  }
  // Bootstrap hypertable TimescaleDB tốn 1-2 giây và không liên quan tới test HTTP.
  jest
    .spyOn(DownsamplerService.prototype, 'onApplicationBootstrap')
    .mockResolvedValue(undefined as any);
}

/** Gỡ mọi cron job đã đăng ký để chúng không ghi DB giữa chừng. */
export function stopAllCronJobs(app: INestApplication): void {
  try {
    const registry = app.get(SchedulerRegistry, { strict: false });
    for (const [name, job] of registry.getCronJobs()) {
      job.stop();
      registry.deleteCronJob(name);
    }
    for (const [name] of registry.getIntervals()) {
      registry.deleteInterval(name);
    }
  } catch {
    // ScheduleModule chưa đăng ký gì — không có gì để dọn.
  }
}

export async function createE2EApp(): Promise<TestApp> {
  disableBootSideEffects();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  // PHẢI khớp chính xác src/main.ts, nếu không hành vi validation/auth sẽ lệch.
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  await app.init();
  stopAllCronJobs(app);

  return { app, moduleRef, ds: app.get(DataSource) };
}

/** Xoá sạch dữ liệu giữa các test. */
export async function resetDb(ds: DataSource): Promise<void> {
  const tables = ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ');
  if (tables) await ds.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/**
 * Ứng dụng cho tầng REALTIME: có microservice MQTT thật và lắng nghe cổng HTTP thật
 * (Socket.IO cần cổng để client kết nối vào).
 *
 * Sao y src/main.ts: connectMicroservice + startAllMicroservices trước khi listen.
 */
export async function createRealtimeApp(): Promise<
  TestApp & { port: number; baseUrl: string; teardown: () => Promise<void> }
> {
  disableBootSideEffects({ keepMqtt: true });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.MQTT,
    options: {
      url: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1884',
      // reconnectPeriod: 0 chỉ dùng trong test. mqtt.js mặc định giữ một bộ đếm
      // tái kết nối chạy vĩnh viễn; bộ đếm này không nằm trong tầm quan sát của
      // async_hooks nên --detectOpenHandles không thấy, nhưng nó giữ tiến trình
      // Node sống và Jest không thoát được sau khi test đã xong.
      reconnectPeriod: 0,
    },
  });

  await app.startAllMicroservices();
  // Cổng 0 = để hệ điều hành cấp cổng trống, tránh đụng nhau khi chạy song song.
  await app.listen(0);
  stopAllCronJobs(app);

  const url = await app.getUrl();
  const port = Number(new URL(url).port);

  return {
    app,
    moduleRef,
    ds: app.get(DataSource),
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    teardown: () => teardownRealtimeApp(app),
  };
}

/**
 * Đóng ứng dụng realtime cho sạch.
 *
 * app.close() KHÔNG đủ: GatewayService tự mở một kết nối MQTT riêng trong
 * onModuleInit nhưng lớp này không cài OnModuleDestroy, nên client đó sống sót
 * qua app.close() và giữ tiến trình Node không thoát được.
 * (Đây là rò rỉ tài nguyên thật, xem mục Lỗ hổng trong báo cáo — ở đây ta dọn hộ
 * để test không phải chạy với --forceExit.)
 */
export async function teardownRealtimeApp(app: INestApplication): Promise<void> {
  try {
    const gatewayService = app.get(GatewayService, { strict: false }) as any;
    const client = gatewayService?.mqttClient;
    if (client && typeof client.end === 'function') {
      await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
    }
  } catch {
    // Không lấy được service thì bỏ qua — app.close() bên dưới vẫn chạy.
  }
  await app.close();
}
