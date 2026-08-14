import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SensorReading } from './entities/sensor-reading.entity';

@Injectable()
export class SensorBufferService implements OnModuleDestroy {
  private readonly logger = new Logger('SensorBuffer');
  private buffer: SensorReading[] = [];
  private bufferKeys: Set<string> = new Set();
  private retryQueue: SensorReading[][] = [];
  
  private readonly FLUSH_INTERVAL_MS = 2000;  // flush mỗi 2 giây
  private readonly FLUSH_SIZE = 100;          // hoặc khi đủ 100 bản ghi
  private readonly MAX_BUFFER_CAPACITY = 10000; // giới hạn chống tràn RAM
  private readonly CHUNK_SIZE = 500;          // chia nhỏ batch khi ghi DB
  private isFlushing = false;
  private intervalId: NodeJS.Timeout;

  constructor(
    @InjectRepository(SensorReading)
    private readonly sensorReadingRepo: Repository<SensorReading>,
  ) {
    this.intervalId = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  push(reading: SensorReading) {
    // Chống tràn bộ nhớ nếu DB gặp sự cố kéo dài (Backpressure)
    if (this.buffer.length >= this.MAX_BUFFER_CAPACITY) {
      this.logger.warn(
        `[SensorBuffer] Buffer đã đạt giới hạn tối đa (${this.MAX_BUFFER_CAPACITY}), loại bỏ bản ghi cũ nhất để bảo vệ hệ thống.`,
      );
      const dropped = this.buffer.shift();
      if (dropped) {
        this.bufferKeys.delete(
          `${dropped.sensorId}:${dropped.sensorType}:${dropped.time.getTime()}`,
        );
      }
    }

    let timeMs = reading.time.getTime();
    let key = `${reading.sensorId}:${reading.sensorType}:${timeMs}`;

    // O(1) kiểm tra trùng timestamp khoá chính bằng Set
    while (this.bufferKeys.has(key)) {
      timeMs += 1;
      reading.time = new Date(timeMs);
      key = `${reading.sensorId}:${reading.sensorType}:${timeMs}`;
    }

    this.bufferKeys.add(key);
    this.buffer.push(reading);

    if (this.buffer.length >= this.FLUSH_SIZE && !this.isFlushing) {
      this.flush();
    }
  }

  async flush() {
    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      // 1. Thử ghi lại các batch retry trước đó nếu có
      if (this.retryQueue.length > 0) {
        const retryBatch = this.retryQueue.shift();
        if (retryBatch && retryBatch.length > 0) {
          await this.writeChunk(retryBatch, true);
        }
      }

      if (this.buffer.length === 0) return;

      // 2. Lấy toàn bộ bản ghi hiện có trong buffer
      const batch = this.buffer.splice(0, this.buffer.length);
      this.bufferKeys.clear();

      // 3. Chia nhỏ batch nếu quá lớn để tối ưu hóa SQL execution plan
      for (let i = 0; i < batch.length; i += this.CHUNK_SIZE) {
        const chunk = batch.slice(i, i + this.CHUNK_SIZE);
        await this.writeChunk(chunk, false);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async writeChunk(chunk: SensorReading[], isRetry: boolean) {
    try {
      await this.sensorReadingRepo.insert(chunk);
      this.logger.log(
        `[SensorBuffer] Đã lưu ${chunk.length} bản ghi cảm biến vào database${isRetry ? ' (Retry)' : ''}.`,
      );
    } catch (error: any) {
      // Nếu bị trùng khoá chính ("time", "sensorId", "sensorType") trong cùng millisecond
      if (error?.code === '23505') {
        let insertedCount = 0;
        for (const item of chunk) {
          try {
            await this.sensorReadingRepo.insert(item);
            insertedCount++;
          } catch {
            // Bỏ qua bản ghi trùng
          }
        }
        this.logger.log(
          `[SensorBuffer] Đã lưu ${insertedCount}/${chunk.length} bản ghi (đã lọc bản ghi trùng khoá).`,
        );
      } else {
        this.logger.error(
          `[SensorBuffer] Lỗi khi ghi hàng loạt vào database: ${error.message || error}`,
        );
        // Lưu vào hàng đợi retry nếu chưa retry
        if (!isRetry && this.retryQueue.length < 20) {
          this.retryQueue.push(chunk);
        }
      }
    }
  }

  async onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    // Ghi nốt dữ liệu còn sót lại khi tắt ứng dụng
    await this.flush();
  }
}
