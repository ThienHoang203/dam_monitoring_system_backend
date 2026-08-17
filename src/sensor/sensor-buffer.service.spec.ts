import { SensorBufferService } from './sensor-buffer.service';
import { SensorReading } from './entities/sensor-reading.entity';
import { createMockRepo, MockRepo } from '../../test/helpers/mock-repo';

/**
 * Lớp đệm ghi TimescaleDB — điểm nghẽn độ tin cậy của toàn bộ đường ingest.
 * Mọi telemetry từ ESP32 đều đi qua đây trước khi xuống DB.
 */
describe('SensorBufferService', () => {
  let repo: MockRepo;
  let service: SensorBufferService;

  const makeReading = (over: Partial<SensorReading> = {}): SensorReading =>
    Object.assign(new SensorReading(), {
      time: new Date('2026-01-01T00:00:00.000Z'),
      sensorId: 'STA-001-01',
      sensorType: 'water_level',
      value: 42,
      unit: 'cm',
      ...over,
    });

  /** Số bản ghi đang nằm trong buffer (state private). */
  const bufferLength = () => (service as any).buffer.length;

  beforeEach(() => {
    // Bật fake timers TRƯỚC khi khởi tạo: constructor gọi setInterval(2000),
    // nếu dùng timer thật thì Jest sẽ không thoát được.
    jest.useFakeTimers();
    repo = createMockRepo();
    service = new SensorBufferService(repo as any);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('gom nhóm và kích hoạt ghi', () => {
    it('chưa đủ 100 bản ghi thì chưa chạm DB', () => {
      for (let i = 0; i < 99; i++) service.push(makeReading({ time: new Date(i) }));
      expect(repo.insert).not.toHaveBeenCalled();
      expect(bufferLength()).toBe(99);
    });

    it('đủ FLUSH_SIZE (100) thì ghi ngay một lần', async () => {
      for (let i = 0; i < 100; i++) service.push(makeReading({ time: new Date(i) }));
      await Promise.resolve();

      expect(repo.insert).toHaveBeenCalledTimes(1);
      expect(repo.insert.mock.calls[0][0]).toHaveLength(100);
    });

    it('interval 2 giây tự flush phần còn lại', async () => {
      for (let i = 0; i < 10; i++) service.push(makeReading({ time: new Date(i) }));
      expect(repo.insert).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(repo.insert).toHaveBeenCalledTimes(1);
      expect(repo.insert.mock.calls[0][0]).toHaveLength(10);
    });

    it('buffer rỗng thì flush không gọi DB', async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe('chống trùng khoá chính trong cùng millisecond', () => {
    // Khoá chính là (time, sensorId, sensorType). Nhiều gói tin tới cùng
    // một millisecond sẽ va khoá — buffer dịch time thêm 1ms cho tới khi trống chỗ.
    it('bản ghi trùng khoá được dịch time +1ms', () => {
      const t = new Date('2026-01-01T00:00:00.000Z');
      const a = makeReading({ time: new Date(t) });
      const b = makeReading({ time: new Date(t) });
      const c = makeReading({ time: new Date(t) });

      service.push(a);
      service.push(b);
      service.push(c);

      expect(a.time.getTime()).toBe(t.getTime());
      expect(b.time.getTime()).toBe(t.getTime() + 1);
      expect(c.time.getTime()).toBe(t.getTime() + 2);
      expect(bufferLength()).toBe(3);
    });

    it('khác sensorId thì không coi là trùng', () => {
      const t = new Date('2026-01-01T00:00:00.000Z');
      const a = makeReading({ time: new Date(t), sensorId: 'STA-001-01' });
      const b = makeReading({ time: new Date(t), sensorId: 'STA-001-02' });

      service.push(a);
      service.push(b);

      expect(b.time.getTime()).toBe(t.getTime());
    });
  });

  describe('chống tràn bộ nhớ khi DB sự cố kéo dài', () => {
    it('vượt MAX_BUFFER_CAPACITY thì loại bản ghi CŨ NHẤT', () => {
      // Mô phỏng DB chết: giữ cờ flush để buffer chỉ dồn lên, không được xả.
      (service as any).isFlushing = true;

      for (let i = 0; i < 10_050; i++) service.push(makeReading({ time: new Date(i) }));

      expect(bufferLength()).toBeLessThanOrEqual(10_000);
      // Bản ghi đầu tiên (time=0) đã bị đẩy ra, phần tử đầu buffer phải mới hơn.
      expect((service as any).buffer[0].time.getTime()).toBeGreaterThan(0);
    });

    it('bản ghi bị loại cũng được xoá khỏi bảng khoá (không rò rỉ Set)', () => {
      (service as any).isFlushing = true;
      for (let i = 0; i < 10_050; i++) service.push(makeReading({ time: new Date(i) }));

      expect((service as any).bufferKeys.size).toBe(bufferLength());
    });
  });

  describe('chia nhỏ batch', () => {
    it('1200 bản ghi được ghi thành 3 chunk 500/500/200', async () => {
      // Giữ cờ isFlushing để push() không tự flush khi chạm mốc 100,
      // nhờ đó dồn đủ 1200 bản ghi rồi mới đo cách chia chunk.
      (service as any).isFlushing = true;
      for (let i = 0; i < 1200; i++) service.push(makeReading({ time: new Date(i) }));
      (service as any).isFlushing = false;

      await service.flush();

      const sizes = repo.insert.mock.calls.map((c) => c[0].length);
      expect(sizes).toEqual([500, 500, 200]);
    });
  });

  describe('xử lý lỗi ghi DB', () => {
    it('lỗi trùng khoá 23505 → ghi lại từng bản ghi, bỏ qua bản trùng', async () => {
      const items = [makeReading({ time: new Date(1) }), makeReading({ time: new Date(2) })];
      items.forEach((r) => service.push(r));

      repo.insert
        .mockRejectedValueOnce({ code: '23505' }) // cả chunk
        .mockResolvedValueOnce({}) // bản 1 OK
        .mockRejectedValueOnce({ code: '23505' }); // bản 2 trùng, bị bỏ qua

      await expect(service.flush()).resolves.toBeUndefined();

      expect(repo.insert).toHaveBeenCalledTimes(3);
      // Không đưa vào retryQueue: bản ghi trùng là mất vĩnh viễn, retry vô nghĩa.
      expect((service as any).retryQueue).toHaveLength(0);
    });

    it('lỗi khác (mất kết nối) → chunk vào hàng đợi retry', async () => {
      service.push(makeReading({ time: new Date(1) }));
      repo.insert.mockRejectedValueOnce(new Error('connection lost'));

      await service.flush();

      expect((service as any).retryQueue).toHaveLength(1);
      expect((service as any).retryQueue[0]).toHaveLength(1);
    });

    it('lần flush kế tiếp thử lại chunk cũ TRƯỚC dữ liệu mới', async () => {
      service.push(makeReading({ time: new Date(1), value: 111 }));
      repo.insert.mockRejectedValueOnce(new Error('connection lost'));
      await service.flush();

      repo.insert.mockClear();
      repo.insert.mockResolvedValue({});
      service.push(makeReading({ time: new Date(2), value: 222 }));
      await service.flush();

      expect(repo.insert).toHaveBeenCalledTimes(2);
      expect(repo.insert.mock.calls[0][0][0].value).toBe(111); // retry trước
      expect(repo.insert.mock.calls[1][0][0].value).toBe(222); // rồi mới tới dữ liệu mới
      expect((service as any).retryQueue).toHaveLength(0);
    });

    it('retry thất bại lần hai KHÔNG quay lại hàng đợi (chống lặp vô hạn)', async () => {
      service.push(makeReading({ time: new Date(1) }));
      repo.insert.mockRejectedValue(new Error('still down'));

      await service.flush(); // lần 1 → vào queue
      expect((service as any).retryQueue).toHaveLength(1);

      await service.flush(); // retry thất bại → bị loại bỏ, không quay lại
      expect((service as any).retryQueue).toHaveLength(0);
    });

    it('hàng đợi retry bị chặn trần ở 20 batch', async () => {
      repo.insert.mockRejectedValue(new Error('down'));

      for (let i = 0; i < 25; i++) {
        service.push(makeReading({ time: new Date(i) }));
        await service.flush();
      }

      expect((service as any).retryQueue.length).toBeLessThanOrEqual(20);
    });
  });

  describe('chống chạy chồng (reentrancy)', () => {
    it('flush đang chạy thì lời gọi thứ hai return ngay', async () => {
      let release: () => void = () => {};
      repo.insert.mockImplementation(() => new Promise<void>((r) => (release = r)));

      service.push(makeReading({ time: new Date(1) }));
      const first = service.flush();
      await Promise.resolve();

      service.push(makeReading({ time: new Date(2) }));
      await service.flush(); // bị chặn bởi cờ isFlushing

      expect(repo.insert).toHaveBeenCalledTimes(1);

      release();
      await first;
      // Trả repo về trạng thái bình thường để flush cuối trong afterEach không treo.
      repo.insert.mockResolvedValue({});
    });
  });

  describe('onModuleDestroy', () => {
    it('dừng interval và ghi nốt dữ liệu còn lại', async () => {
      service.push(makeReading({ time: new Date(1) }));

      await service.onModuleDestroy();
      expect(repo.insert).toHaveBeenCalledTimes(1);

      // Interval đã bị clear — advance thêm không sinh lời gọi mới.
      repo.insert.mockClear();
      jest.advanceTimersByTime(10_000);
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });
});
