/**
 * Dựng `SensorService` cho unit test.
 *
 * Cố ý dùng `new SensorService(...)` thay vì `Test.createTestingModule`:
 *  - Constructor có 14 tham số, khai báo qua DI rất dài dòng.
 *  - `@Cron` chỉ được đăng ký khi có `ScheduleModule.forRoot()` — `new` thì cron không chạy.
 *  - Quan trọng nhất: mỗi lần gọi cho một instance HOÀN TOÀN SẠCH, xử lý dứt điểm
 *    vấn đề ~15 Map state in-memory không bao giờ được reset.
 *
 * `bufferService` LUÔN là stub — `new SensorBufferService()` khởi động setInterval(2000)
 * ngay trong constructor và sẽ rò rỉ timer làm Jest treo.
 */
import { ConfigService } from '@nestjs/config';
import { SensorService } from '../../src/sensor/sensor.service';
import { createMockRepo, MockRepo } from './mock-repo';

export interface SensorServiceDeps {
  sensorReadingRepo: MockRepo;
  thresholdConfigRepo: MockRepo;
  alarmEventRepo: MockRepo;
  statusHistoryRepo: MockRepo;
  stationRepo: MockRepo;
  damRepo: MockRepo;
  gatewayRepo: MockRepo;
  nodeRepo: MockRepo;
  evidenceRepo: MockRepo;
  userRepo: MockRepo;
  bufferService: { push: jest.Mock; flush: jest.Mock };
  configService: ConfigService;
  auditLogService: { logAction: jest.Mock };
  gatewayService: { publishGatewayConfig: jest.Mock; findById: jest.Mock };
}

export function buildSensorService(
  overrides: Partial<SensorServiceDeps> = {},
): { service: SensorService } & SensorServiceDeps {
  const deps: SensorServiceDeps = {
    sensorReadingRepo: createMockRepo(),
    thresholdConfigRepo: createMockRepo(),
    alarmEventRepo: createMockRepo(),
    statusHistoryRepo: createMockRepo(),
    stationRepo: createMockRepo(),
    damRepo: createMockRepo(),
    gatewayRepo: createMockRepo(),
    nodeRepo: createMockRepo(),
    evidenceRepo: createMockRepo(),
    userRepo: createMockRepo(),
    bufferService: { push: jest.fn(), flush: jest.fn() },
    configService: new ConfigService({ SMTP_USER: '', SMTP_PASS: '' }),
    auditLogService: { logAction: jest.fn().mockResolvedValue(null) },
    gatewayService: {
      publishGatewayConfig: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
    },
    ...overrides,
  };

  // Thứ tự PHẢI khớp constructor của SensorService (sensor.service.ts:99).
  const service = new SensorService(
    deps.sensorReadingRepo as any,
    deps.thresholdConfigRepo as any,
    deps.alarmEventRepo as any,
    deps.statusHistoryRepo as any,
    deps.stationRepo as any,
    deps.damRepo as any,
    deps.gatewayRepo as any,
    deps.nodeRepo as any,
    deps.evidenceRepo as any,
    deps.userRepo as any,
    deps.bufferService as any,
    deps.configService,
    deps.auditLogService as any,
    deps.gatewayService as any,
  );

  return { service, ...deps };
}

/**
 * Bơm thẳng state private của service.
 * Dùng khi test một nhánh cụ thể mà không muốn chạy cả pipeline ingest để dựng state.
 */
export function seedPrivate(service: SensorService, patch: Record<string, any>): void {
  Object.assign(service as any, patch);
}

/** Truy cập method private trong test mà không cần rải `as any` khắp nơi. */
export function priv(service: any): any {
  return service;
}
