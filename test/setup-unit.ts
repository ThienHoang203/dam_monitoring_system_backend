/**
 * Setup chung cho UNIT TEST.
 *
 * Chạy trước mỗi file spec (setupFilesAfterEnv), lo hai việc:
 *  1. Nạp biến môi trường từ .env.test — AuthModule throw lúc bootstrap nếu
 *     JWT_SECRET thiếu hoặc ngắn hơn 32 ký tự.
 *  2. Mock ba package tạo client "inline" trong thân method nên không stub được qua DI:
 *     mqtt (GatewayService), nodemailer (AuthService/SensorService), minio (EvidenceService).
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';

loadEnv({ path: join(__dirname, '..', '.env.test'), override: true, quiet: true });

jest.mock('mqtt', () => require('./mocks/mqtt.mock').mqttModuleMock);
jest.mock('nodemailer', () => require('./mocks/nodemailer.mock').nodemailerModuleMock);
jest.mock('minio', () => require('./mocks/minio.mock').minioModuleMock);

// Service trong repo log rất nhiều qua console.* và Logger của Nest — giữ nguyên
// sẽ làm output test không đọc được (và báo cáo ở Phase 8 đầy nhiễu).
// Đặt TEST_VERBOSE=1 khi cần debug để xem lại toàn bộ log.
if (process.env.TEST_VERBOSE !== '1') {
  global.console.log = jest.fn();
  global.console.warn = jest.fn();
  // Logger của Nest ghi thẳng ra stdout, không đi qua console.* nên phải tắt riêng.
  const { Logger } = require('@nestjs/common');
  Logger.overrideLogger(false);
}

// Chặn test bị treo âm thầm vì promise reject không ai bắt.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[test] Unhandled rejection:', reason);
});
