/**
 * Setup cho E2E TEST.
 *
 * Khác setup-unit ở chỗ: DB là thật (Postgres ở cổng 5433), còn MQTT/MinIO/SMTP
 * vẫn mock để test không phụ thuộc broker và object storage.
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
