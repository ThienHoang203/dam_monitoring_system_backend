/**
 * Factory dữ liệu test.
 *
 * Mỗi factory trả về một entity hợp lệ theo đúng quy tắc đặt tên A.3.2, cho phép
 * override từng field. Nhờ đó test chỉ cần khai báo phần nó thực sự quan tâm.
 */
import { User, UserRole, UserStatus } from '../../src/auth/entities/user.entity';
import { Dam } from '../../src/dam/entities/dam.entity';
import { Station } from '../../src/dam/entities/station.entity';
import { Gateway } from '../../src/gateway/entities/gateway.entity';
import { Node } from '../../src/node/entities/node.entity';
import { Sensor } from '../../src/node/entities/sensor.entity';
import { Camera } from '../../src/camera/entities/camera.entity';
import { ThresholdConfig } from '../../src/sensor/entities/threshold-config.entity';
import { AlarmEvent } from '../../src/sensor/entities/alarm-event.entity';
import { SensorDataDto, SensorSnapshot } from '../../src/sensor/sensor.dto';

type Partialize<T> = Partial<Record<keyof T, any>>;

function build<T extends object>(base: T, overrides: Partialize<T> = {}): T {
  return Object.assign(base, overrides);
}

// ── Auth ──

export function makeUser(overrides: Partialize<User> = {}): User {
  return build(
    Object.assign(new User(), {
      id: 'user-uuid-1',
      email: 'operator@example.test',
      username: 'operator1',
      // Hash của 'password123' — dùng khi test cần bcrypt.compare thành công.
      passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
      fullName: 'Nguyễn Văn A',
      phoneNumber: '0900000000',
      role: 'OPERATOR' as UserRole,
      status: 'ACTIVE' as UserStatus,
      assignedDamId: 'DAM-001',
      mustChangePassword: false,
      lastLoginAt: null as any,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }),
    overrides,
  );
}

export const makeAdmin = (o: Partialize<User> = {}) =>
  makeUser({ id: 'admin-uuid', username: 'admin', email: 'admin@example.test', role: 'ADMIN', assignedDamId: null, ...o });

export const makeOperator = (damId = 'DAM-001', o: Partialize<User> = {}) =>
  makeUser({ role: 'OPERATOR', assignedDamId: damId, ...o });

export const makeViewer = (o: Partialize<User> = {}) =>
  makeUser({ id: 'viewer-uuid', username: 'viewer', email: 'viewer@example.test', role: 'VIEWER', ...o });

// ── Thiết bị ──

export function makeDam(overrides: Partialize<Dam> = {}): Dam {
  return build(
    Object.assign(new Dam(), {
      id: 1,
      damId: 'DAM-001',
      name: 'Đập Thủy điện Test',
      location: 'Tỉnh Test',
      latitude: 21.0,
      longitude: 105.8,
      waterLevel: 0,
      flow: 0,
      fillPct: 0,
      status: 'unknown',
      statusReason: null as any,
      stations: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }),
    overrides,
  );
}

export function makeStation(overrides: Partialize<Station> = {}): Station {
  const station = Object.assign(new Station(), {
    id: 1,
    stationId: 'STA-001-01',
    stationCode: 'ST01',
    name: 'Trạm quan trắc 01',
    location: 'Thân đập',
    km: 'KM0+100',
    status: 'unknown',
    waterLevel: 0,
    change: 0,
    pressure: 0,
    flow: 0,
    humidity: 0,
    vibration: 0,
    bd1: 0,
    bd2: 0,
    bd3: 0,
    damRefId: 1,
    dam: undefined as any,
    gateways: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  Object.assign(station, overrides);
  // Mô phỏng @AfterLoad: trường ảo damId chỉ có giá trị khi quan hệ dam đã được load.
  station.hydrateParentCodes();
  return station;
}

export function makeGateway(overrides: Partialize<Gateway> = {}): Gateway {
  const gw = Object.assign(new Gateway(), {
    id: 1,
    gatewayId: 'GTW-ST01-TX2A',
    name: 'Jetson TX2 trạm 01',
    macAddress: '02:AA:BB:CC:DD:01',
    firmwareVersion: 'v1.0.0',
    status: 'offline',
    lastSeenAt: null as any,
    stationRefId: 1,
    station: undefined as any,
    cameras: [],
    nodes: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  Object.assign(gw, overrides);
  gw.hydrateParentCodes();
  return gw;
}

export function makeNode(overrides: Partialize<Node> = {}): Node {
  const node = Object.assign(new Node(), {
    id: 1,
    nodeId: 'NOD-GW01-ESP01',
    name: 'Node đo rung 01',
    macAddress: '02:11:22:33:44:01',
    firmwareVersion: 'v1.0.0',
    status: 'offline',
    lastSeenAt: null as any,
    vibrationThreshold: 15.0,
    warnHigh: 2.5,
    criticalHigh: 25.0,
    alertMinCount: 4,
    alertMinDurationSec: 6.0,
    episodeResetGapSec: 3.0,
    gatewayRefId: 1,
    gateway: undefined as any,
    mappedCameraRefId: null,
    mappedCamera: undefined as any,
    sensors: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  Object.assign(node, overrides);
  node.hydrateParentCodes();
  return node;
}

export function makeSensor(overrides: Partialize<Sensor> = {}): Sensor {
  const sensor = Object.assign(new Sensor(), {
    id: 1,
    sensorId: 'SNR-VIB-ESP01-I2C1',
    sensorType: 'VIB',
    model: 'MPU6050',
    unit: 'mm/s',
    status: 'active',
    calibrationOffset: 0,
    nodeRefId: 1,
    node: undefined as any,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  Object.assign(sensor, overrides);
  sensor.hydrateParentCodes();
  return sensor;
}

export function makeCamera(overrides: Partialize<Camera> = {}): Camera {
  const cam = Object.assign(new Camera(), {
    id: 1,
    cameraId: 'CAM-CSI-ST01-01',
    cameraType: 'CSI',
    name: 'Camera thân đập 01',
    streamUrl: null as any,
    status: 'active',
    resolution: '1280x720',
    gatewayRefId: 1,
    gateway: undefined as any,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  Object.assign(cam, overrides);
  cam.hydrateParentCodes();
  return cam;
}

// ── Ngưỡng & cảnh báo ──

/**
 * Giá trị mặc định PHẢI khớp SensorService.ensureThresholdConfigs() — nếu lệch,
 * test sẽ xanh trên dữ liệu không tồn tại ngoài production.
 */
export const DEFAULT_THRESHOLDS = {
  vibration: { warnLow: 0, warnHigh: 2.5, alertLow: 2.5, alertHigh: 15.0, criticalHigh: 25.0, sustainedSeconds: 3, tankHeight: 50 },
  water_level: { warnLow: 0, warnHigh: 42.5, alertLow: 42.5, alertHigh: 50.0, criticalHigh: 55.0, sustainedSeconds: null, tankHeight: 50.0 },
  humidity: { warnLow: 0, warnHigh: 75.0, alertLow: 75.0, alertHigh: 85.0, criticalHigh: 95.0, sustainedSeconds: null, tankHeight: 50 },
} as const;

export function makeThresholdConfig(overrides: Partialize<ThresholdConfig> = {}): ThresholdConfig {
  const sensorType = (overrides.sensorType as keyof typeof DEFAULT_THRESHOLDS) || 'water_level';
  const defaults = DEFAULT_THRESHOLDS[sensorType] ?? DEFAULT_THRESHOLDS.water_level;
  return build(
    Object.assign(new ThresholdConfig(), {
      id: `threshold-${sensorType}`,
      stationId: 'STA-001-01',
      damId: 'DAM-001',
      sensorType,
      ...defaults,
      cameraEnabled: true,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }),
    overrides,
  );
}

/** Bộ 3 ngưỡng mặc định (vibration / water_level / humidity) cho một trạm. */
export function makeThresholdSet(stationId = 'STA-001-01', damId = 'DAM-001'): ThresholdConfig[] {
  return (['vibration', 'water_level', 'humidity'] as const).map((sensorType) =>
    makeThresholdConfig({ stationId, damId, sensorType }),
  );
}

export function makeAlarmEvent(overrides: Partialize<AlarmEvent> = {}): AlarmEvent {
  return build(
    Object.assign(new AlarmEvent(), {
      id: 'alarm-uuid-1',
      eventId: 'evt-0001',
      damId: 'DAM-001',
      sensorId: 'STA-001-01',
      sensorType: 'water_level',
      severity: 'WARNING',
      thresholdVal: 42.5,
      measuredVal: 45,
      triggeredAt: new Date('2026-01-01T00:00:00Z'),
      resolvedAt: null as any,
      cameraActivated: false,
      imageUrl: null as any,
      stationId: 'STA-001-01',
      stationName: 'Trạm quan trắc 01',
      damName: 'Đập Thủy điện Test',
      location: 'Thân đập',
      notes: null as any,
    }),
    overrides,
  );
}

// ── Telemetry ──

export function makeSensorDataDto(overrides: Partialize<SensorDataDto> = {}): SensorDataDto {
  return build(
    new SensorDataDto(50, 1.2, 3.0, 45, 6, 'sensor_node_1', 'STA-001-01', 'DAM-001'),
    overrides,
  );
}

export function makeSnapshot(overrides: Partialize<SensorSnapshot> = {}): SensorSnapshot {
  return build(
    {
      clusterId: 'sensor_node_1',
      stationId: 'STA-001-01',
      damId: 'DAM-001',
      freq: 50,
      amp: 1.2,
      waterLevel: 3.0,
      moisture: 45,
      percent: 6,
      timestamp: '2026-01-01T00:00:00.000Z',
    } as SensorSnapshot,
    overrides,
  );
}
