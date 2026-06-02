import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SensorReading } from './entities/sensor-reading.entity';

@Injectable()
export class SensorBufferService implements OnModuleDestroy {
  private buffer: SensorReading[] = [];
  private readonly FLUSH_INTERVAL_MS = 2000; // flush mỗi 2 giây
  private readonly FLUSH_SIZE = 100;         // hoặc khi đủ 100 bản ghi
  private intervalId: NodeJS.Timeout;

  constructor(
    @InjectRepository(SensorReading)
    private readonly sensorReadingRepo: Repository<SensorReading>,
  ) {
    this.intervalId = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  push(reading: SensorReading) {
    this.buffer.push(reading);
    if (this.buffer.length >= this.FLUSH_SIZE) {
      this.flush();
    }
  }

  async flush() {
    if (this.buffer.length === 0) return;

    // Lấy toàn bộ bản ghi hiện có trong buffer
    const batch = this.buffer.splice(0, this.buffer.length);
    
    try {
      // Ghi hàng loạt (bulk insert) vào TimescaleDB
      await this.sensorReadingRepo.insert(batch);
      console.log(`[SensorBuffer] Đã ghi hàng loạt ${batch.length} bản ghi cảm biến vào database.`);
    } catch (error) {
      console.error('[SensorBuffer] Lỗi khi ghi hàng loạt vào database:', error);
      // Fallback: Nếu ghi thất bại, đẩy ngược lại buffer để ghi lại sau (hoặc log lỗi)
      this.buffer.unshift(...batch);
    }
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    // Ghi nốt dữ liệu còn sót lại khi tắt ứng dụng
    this.flush();
  }
}
