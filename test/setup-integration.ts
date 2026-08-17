/**
 * Setup cho INTEGRATION TEST — chạy trên Postgres/TimescaleDB thật.
 *
 * Không mock gì ngoài mqtt/nodemailer/minio: mục đích của tầng này là kiểm tra
 * đúng hành vi TypeORM (cascade, unique, @AfterLoad, composite PK).
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';

loadEnv({ path: join(__dirname, '..', '.env.test'), override: true, quiet: true });

jest.mock('mqtt', () => require('./mocks/mqtt.mock').mqttModuleMock);
jest.mock('nodemailer', () => require('./mocks/nodemailer.mock').nodemailerModuleMock);
jest.mock('minio', () => require('./mocks/minio.mock').minioModuleMock);

if (process.env.TEST_VERBOSE !== '1') {
  global.console.log = jest.fn();
  global.console.warn = jest.fn();
}
