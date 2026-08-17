/**
 * Setup cho tầng REALTIME (MQTT + WebSocket với hạ tầng thật).
 *
 * Khác biệt duy nhất nhưng then chốt so với setup-e2e.ts: KHÔNG mock `mqtt`.
 * Mục đích của tầng này chính là kiểm chứng đường đi thật qua broker Mosquitto,
 * nên mock module sẽ vô hiệu hoá toàn bộ giá trị của nó.
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';

loadEnv({ path: join(__dirname, '..', '.env.test'), override: true, quiet: true });

// Chỉ mock hai thứ không liên quan tới realtime: gửi email và lưu trữ ảnh.
jest.mock('nodemailer', () => require('./mocks/nodemailer.mock').nodemailerModuleMock);
jest.mock('minio', () => require('./mocks/minio.mock').minioModuleMock);

if (process.env.TEST_VERBOSE !== '1') {
  global.console.log = jest.fn();
  global.console.warn = jest.fn();
  const { Logger } = require('@nestjs/common');
  Logger.overrideLogger(false);
}
