/**
 * Bootstrap ứng dụng cho E2E test.
 *
 * PHẢI khớp chính xác với src/main.ts — nếu thiếu cookieParser hoặc sai option của
 * ValidationPipe thì hành vi auth/validation trong test sẽ lệch với production và
 * test mất giá trị (đặc biệt `forbidNonWhitelisted: true`, thứ khiến field thừa trả 400).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

export async function createTestApp(): Promise<{ app: INestApplication; moduleRef: TestingModule }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  applyGlobalSetup(app);
  await app.init();

  return { app, moduleRef };
}

/** Áp dụng đúng middleware/pipe toàn cục như main.ts. */
export function applyGlobalSetup(app: INestApplication): void {
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
