import { VibrationWindowService } from './vibration-window.service';

/**
 * Máy trạng thái rung động: cửa sổ trượt 10 giây, cần đủ `alertMinCount` mẫu
 * vượt ngưỡng ALERT mới coi là sự cố thật (chống nhiễu xung đơn lẻ).
 *
 * LƯU Ý: service này hiện KHÔNG được đăng ký ở module nào (dead code).
 * Test vẫn có giá trị vì đây là hàm thuần và là đặc tả rõ ràng nhất của logic rung.
 */
describe('VibrationWindowService', () => {
  let service: VibrationWindowService;

  // Ngưỡng rung mặc định thật của hệ thống
  const config = { warnHigh: 2.5, alertHigh: 15.0, criticalHigh: 25.0, alertMinCount: 4 };
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  const at = (offsetMs: number) => new Date(t0.getTime() + offsetMs);

  beforeEach(() => {
    // Instance mới mỗi test — alertWindowMap là state nội bộ, không tự reset.
    service = new VibrationWindowService();
  });

  describe('CRITICAL — kích hoạt tức thì', () => {
    it('vượt criticalHigh là breach ngay, không cần đủ số mẫu', () => {
      expect(service.evaluate('S1', 30, t0, config)).toEqual({
        breach: true,
        severity: 'CRITICAL',
        durationMs: 0,
      });
    });

    it('đúng biên criticalHigh cũng là CRITICAL (dùng >=)', () => {
      expect(service.evaluate('S1', 25.0, t0, config).severity).toBe('CRITICAL');
      expect(service.evaluate('S1', 24.999, t0, config).severity).not.toBe('CRITICAL');
    });

    // CRITICAL return sớm trước khi đẩy mốc vào cửa sổ — nghĩa là các mẫu CRITICAL
    // KHÔNG đóng góp vào bộ đếm mật độ của ALERT.
    it('mẫu CRITICAL không được tính vào cửa sổ mật độ ALERT', () => {
      service.evaluate('S1', 30, at(0), config);
      service.evaluate('S1', 30, at(100), config);
      service.evaluate('S1', 30, at(200), config);
      // 3 mẫu CRITICAL rồi 1 mẫu ALERT: nếu CRITICAL có được đếm thì đã đủ 4.
      const result = service.evaluate('S1', 16, at(300), config);
      expect(result).toEqual({ breach: false, severity: 'WARNING', durationMs: 0 });
    });
  });

  describe('ALERT — mật độ trong cửa sổ 10s', () => {
    it('3 mẫu đầu chưa đủ dày, trả WARNING với durationMs tăng dần', () => {
      expect(service.evaluate('S1', 16, at(0), config)).toEqual({ breach: false, severity: 'WARNING', durationMs: 0 });
      expect(service.evaluate('S1', 16, at(1000), config)).toEqual({ breach: false, severity: 'WARNING', durationMs: 1000 });
      expect(service.evaluate('S1', 16, at(2000), config)).toEqual({ breach: false, severity: 'WARNING', durationMs: 2000 });
    });

    it('mẫu thứ 4 trong cùng cửa sổ → breach ALERT', () => {
      service.evaluate('S1', 16, at(0), config);
      service.evaluate('S1', 16, at(1000), config);
      service.evaluate('S1', 16, at(2000), config);
      expect(service.evaluate('S1', 16, at(3000), config)).toEqual({
        breach: true,
        severity: 'ALERT',
        durationMs: 3000,
      });
    });

    it('alertMinCount tuỳ chỉnh được tôn trọng', () => {
      const cfg2 = { ...config, alertMinCount: 2 };
      expect(service.evaluate('S1', 16, at(0), cfg2).breach).toBe(false);
      expect(service.evaluate('S1', 16, at(500), cfg2).breach).toBe(true);
    });

    it('alertMinCount thiếu → mặc định 4', () => {
      const cfg = { warnHigh: 2.5, alertHigh: 15, criticalHigh: 25 } as any;
      for (let i = 0; i < 3; i++) expect(service.evaluate('S1', 16, at(i * 100), cfg).breach).toBe(false);
      expect(service.evaluate('S1', 16, at(300), cfg).breach).toBe(true);
    });
  });

  describe('trượt cửa sổ', () => {
    it('mốc cũ hơn 10s bị loại, bộ đếm khởi động lại', () => {
      service.evaluate('S1', 16, at(0), config);
      service.evaluate('S1', 16, at(1000), config);
      service.evaluate('S1', 16, at(2000), config);
      // Mẫu thứ 4 nhưng cách 15s — 3 mốc cũ đã trượt khỏi cửa sổ.
      expect(service.evaluate('S1', 16, at(15000), config)).toEqual({
        breach: false,
        severity: 'WARNING',
        durationMs: 0,
      });
    });

    it('mốc đúng biên cutoff (t - 10000ms) vẫn được giữ', () => {
      service.evaluate('S1', 16, at(0), config);
      service.evaluate('S1', 16, at(1), config);
      service.evaluate('S1', 16, at(2), config);
      // cutoff = 10000 - 10000 = 0, mốc tại 0 thoả `>= cutoff` nên còn lại đủ 3 + 1 = 4.
      expect(service.evaluate('S1', 16, at(10000), config).breach).toBe(true);
    });
  });

  describe('WARNING / NORMAL', () => {
    it.each([
      [2.5, 'WARNING', 'đúng biên warnHigh'],
      [10, 'WARNING', 'giữa warn và alert'],
      [14.999, 'WARNING', 'sát dưới alertHigh'],
      [2.499, 'NORMAL', 'sát dưới warnHigh'],
      [0.25, 'NORMAL', 'nhiễu nền'],
      [0, 'NORMAL', 'không rung'],
    ])('ppv %p → %s (%s)', (ppv, expected) => {
      expect(service.evaluate('S1', ppv as number, t0, config).severity).toBe(expected);
    });

    it('mẫu dưới ngưỡng ALERT không làm bẩn cửa sổ', () => {
      service.evaluate('S1', 16, at(0), config);
      service.evaluate('S1', 5, at(100), config); // WARNING, không được đếm
      service.evaluate('S1', 5, at(200), config);
      service.evaluate('S1', 5, at(300), config);
      expect(service.evaluate('S1', 16, at(400), config).breach).toBe(false);
    });
  });

  describe('dung sai đầu vào & cô lập theo sensor', () => {
    it('chấp nhận timestamp dạng chuỗi ISO', () => {
      const result = service.evaluate('S1', 16, '2026-01-01T00:00:00.000Z', config);
      expect(result.durationMs).toBe(0);
      expect(Number.isNaN(result.durationMs)).toBe(false);
    });

    it('mỗi sensorId có cửa sổ riêng', () => {
      service.evaluate('S1', 16, at(0), config);
      service.evaluate('S2', 16, at(100), config);
      service.evaluate('S1', 16, at(200), config);
      service.evaluate('S2', 16, at(300), config);
      // Mỗi sensor mới có 2 mẫu — chưa sensor nào đủ 4.
      expect(service.evaluate('S1', 16, at(400), config).breach).toBe(false);
      expect(service.evaluate('S2', 16, at(500), config).breach).toBe(false);
    });
  });
});
