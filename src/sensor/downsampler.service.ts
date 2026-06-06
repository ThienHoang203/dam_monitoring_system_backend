import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

@Injectable()
export class DownsamplerService implements OnApplicationBootstrap {
  constructor(private readonly dataSource: DataSource) {}

  // Khởi tạo các bảng chuỗi thời gian của TimescaleDB lúc khởi chạy ứng dụng
  async onApplicationBootstrap() {
    console.log('[Downsampler] Bắt đầu khởi tạo database và hypertables...');
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // TypeORM tự động tạo bảng sensor_readings thông qua entities sync (synchronize: true).
      // Tên cột TypeORM tạo ra là camelCase có dấu ngoặc kép: "sensorId", "sensorType", "damId"

      // Chuyển bảng sensor_readings thành TimescaleDB Hypertable (nếu chưa là hypertable)
      const isHypertable = await queryRunner.query(`
        SELECT * FROM timescaledb_information.hypertables 
        WHERE hypertable_name = 'sensor_readings'
      `);

      if (isHypertable.length === 0) {
        try {
          // Bật extension TimescaleDB (yêu cầu quyền Superuser trên postgres)
          await queryRunner.query('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;');

          // Chuyển bảng thành hypertable theo trục thời gian 'time'
          await queryRunner.query("SELECT create_hypertable('sensor_readings', 'time', if_not_exists => TRUE);");

          // Tạo index để tối ưu truy vấn — tên cột camelCase có dấu ngoặc kép như TypeORM tạo ra
          await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_sensor_readings_sensor_time ON sensor_readings ("sensorId", time DESC);');

          // Bật nén TimescaleDB
          await queryRunner.query(`
            ALTER TABLE sensor_readings SET (
              timescaledb.compress,
              timescaledb.compress_segmentby = '"sensorId"'
            );
          `);

          // Thêm chính sách nén sau 7 ngày
          await queryRunner.query("SELECT add_compression_policy('sensor_readings', INTERVAL '7 days', if_not_exists => TRUE);");

          console.log('[Downsampler] Đã chuyển đổi thành công bảng sensor_readings sang TimescaleDB Hypertable và cấu hình nén.');
        } catch (err: any) {
          console.warn('[Downsampler] Không thể cấu hình TimescaleDB extension (có thể database đang chạy ở chế độ PostgreSQL thường hoặc thiếu quyền):', err.message);
        }
      }

      // Kiểm tra cấu trúc cột của bảng sensor_readings_1min nếu đã tồn tại
      const columns = await queryRunner.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'sensor_readings_1min'
      `);
      
      const hasCamelCase = columns.some((c: any) => c.column_name === 'sensorId');
      if (columns.length > 0 && !hasCamelCase) {
        console.log('[Downsampler] Phát hiện bảng sensor_readings_1min có cấu trúc cột cũ (snake_case/lowercase). Đang tiến hành xóa bảng cũ để tạo lại đúng chuẩn camelCase...');
        await queryRunner.query('DROP TABLE IF EXISTS sensor_readings_1min CASCADE;');
      }

      // Tạo bảng tổng hợp phút sensor_readings_1min nếu chưa tồn tại.
      // Dùng tên cột camelCase có dấu ngoặc kép để đồng nhất với bảng sensor_readings.
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS sensor_readings_1min (
          time           TIMESTAMPTZ        NOT NULL,
          "sensorId"     VARCHAR(64)        NOT NULL,
          "sensorType"   VARCHAR(32)        NOT NULL,
          avg_value      DOUBLE PRECISION   NOT NULL,
          min_value      DOUBLE PRECISION   NOT NULL,
          max_value      DOUBLE PRECISION   NOT NULL,
          "damId"        VARCHAR(64)        NOT NULL,
          PRIMARY KEY (time, "sensorId", "sensorType")
        );
      `);
      console.log('[Downsampler] Khởi tạo thành công bảng tổng hợp sensor_readings_1min.');
      
      // Chạy gộp dữ liệu thử nghiệm ngay khi khởi chạy ứng dụng để tiện kiểm tra
      this.downsampleToMinutes().catch(err => {
        console.error('[Downsampler] Lỗi chạy downsample lúc khởi chạy:', err);
      });
    } catch (error) {
      console.error('[Downsampler] Lỗi nghiêm trọng khi khởi tạo database:', error);
    } finally {
      await queryRunner.release();
    }
  }

  // Cron Job chạy mỗi 5 phút để downsample dữ liệu thô sang trung bình 1 phút
  @Cron('*/5 * * * *')
  async downsampleToMinutes() {
    console.log('[Downsampler] Đang chạy cron downsample sang 1 phút...');
    try {
      await this.dataSource.query(`
        INSERT INTO sensor_readings_1min
          (time, "sensorId", "sensorType", avg_value, min_value, max_value, "damId")
        SELECT
          time_bucket('1 minute', time) AS time,
          "sensorId",
          "sensorType",
          AVG(value) as avg_value,
          MIN(value) as min_value,
          MAX(value) as max_value,
          "damId"
        FROM sensor_readings
        WHERE time > NOW() - INTERVAL '10 minutes'
        GROUP BY time_bucket('1 minute', time), "sensorId", "sensorType", "damId"
        ON CONFLICT (time, "sensorId", "sensorType") DO UPDATE SET
          avg_value = EXCLUDED.avg_value,
          min_value = EXCLUDED.min_value,
          max_value = EXCLUDED.max_value
      `);
      console.log('[Downsampler] Đã hoàn thành downsample dữ liệu sang bảng 1 phút.');
    } catch (error) {
      console.error('[Downsampler] Lỗi khi thực hiện downsample dữ liệu:', error);
    }
  }

  // Cron Job chạy vào 01:00 hàng ngày để giải phóng dữ liệu thô quá 7 ngày
  @Cron('0 1 * * *')
  async pruneOldRawData() {
    console.log('[Downsampler] Đang dọn dẹp các chunk dữ liệu thô cũ hơn 7 ngày...');
    try {
      await this.dataSource.query(`
        SELECT drop_chunks('sensor_readings', INTERVAL '7 days');
      `);
      console.log('[Downsampler] Đã dọn dẹp các chunk dữ liệu thô cũ thành công.');
    } catch (error: any) {
      console.warn('[Downsampler] Không thể drop_chunks. Fallback sang DELETE thường:', error.message);
      try {
        await this.dataSource.query(`
          DELETE FROM sensor_readings WHERE time < NOW() - INTERVAL '7 days';
        `);
        console.log('[Downsampler] Fallback DELETE dữ liệu cũ thành công.');
      } catch (delErr) {
        console.error('[Downsampler] Lỗi khi chạy fallback DELETE dữ liệu cũ:', delErr);
      }
    }
  }
}
