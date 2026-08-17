/**
 * Helper DataSource cho INTEGRATION TEST.
 *
 * Dùng `synchronize: true` giống app thật (repo không có migration), nên schema
 * được sinh trực tiếp từ entity — bám sát production.
 */
import { DataSource } from 'typeorm';
import { User } from '../../src/auth/entities/user.entity';
import { Dam } from '../../src/dam/entities/dam.entity';
import { Station } from '../../src/dam/entities/station.entity';
import { Gateway } from '../../src/gateway/entities/gateway.entity';
import { Node } from '../../src/node/entities/node.entity';
import { Sensor } from '../../src/node/entities/sensor.entity';
import { Camera } from '../../src/camera/entities/camera.entity';
import { SensorReading } from '../../src/sensor/entities/sensor-reading.entity';
import { ThresholdConfig } from '../../src/sensor/entities/threshold-config.entity';
import { AlarmEvent } from '../../src/sensor/entities/alarm-event.entity';
import { StationStatusHistory } from '../../src/sensor/entities/station-status-history.entity';
import { Evidence } from '../../src/evidence/entities/evidence.entity';
import { SystemLog } from '../../src/audit-log/entities/system-log.entity';

export const TEST_ENTITIES = [
  User, Dam, Station, Gateway, Node, Sensor, Camera,
  SensorReading, ThresholdConfig, AlarmEvent, StationStatusHistory,
  Evidence, SystemLog,
];

export function testDataSourceOptions() {
  return {
    type: 'postgres' as const,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'dam_monitoring_test',
    entities: TEST_ENTITIES,
    synchronize: true,
    logging: false as const,
  };
}

export async function createTestDataSource(): Promise<DataSource> {
  const ds = new DataSource(testDataSourceOptions());
  await ds.initialize();
  return ds;
}

/**
 * Xoá sạch mọi bảng giữa các test.
 * TRUNCATE ... CASCADE nhanh hơn nhiều so với xoá từng repo và tự lo thứ tự khoá ngoại.
 */
export async function truncateAll(ds: DataSource): Promise<void> {
  const tables = ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ');
  if (!tables) return;
  await ds.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/** true nếu instance Postgres đang chạy có extension TimescaleDB. */
export async function hasTimescale(ds: DataSource): Promise<boolean> {
  const rows = await ds.query(
    `SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'`,
  );
  return rows.length > 0;
}
