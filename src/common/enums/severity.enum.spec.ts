import {
  Severity,
  SEVERITY_STATUS_MAP,
  classifySeverity,
  severityFromString,
  severityToStatus,
} from './severity.enum';
import { makeThresholdConfig } from '../../../test/helpers/factories';

/**
 * Ba hàm này là nền của toàn bộ pipeline đánh giá an toàn (station → dam).
 * Sai ở đây nghĩa là hệ thống phân loại sai mức nguy hiểm của đập.
 */
describe('severity.enum', () => {
  // Ngưỡng mực nước thật của hệ thống: BĐ1 42.5m / BĐ2 50m / BĐ3 55m
  const waterConfig = makeThresholdConfig({ sensorType: 'water_level' });

  describe('classifySeverity', () => {
    it('trả NORMAL khi không có config', () => {
      expect(classifySeverity(999, null)).toBe(Severity.NORMAL);
      expect(classifySeverity(999, undefined)).toBe(Severity.NORMAL);
    });

    it('trả NORMAL khi giá trị không đo được', () => {
      expect(classifySeverity(null, waterConfig)).toBe(Severity.NORMAL);
      expect(classifySeverity(undefined, waterConfig)).toBe(Severity.NORMAL);
      expect(classifySeverity(NaN, waterConfig)).toBe(Severity.NORMAL);
    });

    // Cascade phải kiểm CRITICAL trước, nếu đảo thứ tự thì giá trị vượt cả 3 ngưỡng
    // sẽ bị phân loại nhầm thành WARNING — đúng loại bug làm mất cảnh báo nguy cấp.
    it.each([
      [56, Severity.CRITICAL, 'trên BĐ3'],
      [55, Severity.CRITICAL, 'đúng BĐ3 (biên >=)'],
      [54.999, Severity.ALERT, 'sát dưới BĐ3'],
      [50, Severity.ALERT, 'đúng BĐ2'],
      [49.999, Severity.WARNING, 'sát dưới BĐ2'],
      [42.5, Severity.WARNING, 'đúng BĐ1'],
      [42.499, Severity.NORMAL, 'sát dưới BĐ1'],
      [0, Severity.NORMAL, 'không có nước'],
      [-5, Severity.NORMAL, 'giá trị âm'],
    ])('mực nước %pm → %p (%s)', (value, expected) => {
      expect(classifySeverity(value as number, waterConfig)).toBe(expected);
    });

    it('bỏ qua ngưỡng null và tụt xuống bậc kế tiếp', () => {
      const noCritical = makeThresholdConfig({ criticalHigh: null });
      expect(classifySeverity(999, noCritical)).toBe(Severity.ALERT);

      const onlyCritical = makeThresholdConfig({ warnHigh: null, alertHigh: null, criticalHigh: 55 });
      expect(classifySeverity(50, onlyCritical)).toBe(Severity.NORMAL);
      expect(classifySeverity(60, onlyCritical)).toBe(Severity.CRITICAL);
    });

    it('trả NORMAL khi cả ba ngưỡng đều null', () => {
      const empty = makeThresholdConfig({ warnHigh: null, alertHigh: null, criticalHigh: null });
      expect(classifySeverity(9999, empty)).toBe(Severity.NORMAL);
    });
  });

  describe('severityFromString', () => {
    it.each([
      ['CRITICAL', Severity.CRITICAL],
      ['critical', Severity.CRITICAL],
      ['Critical', Severity.CRITICAL],
      ['ALERT', Severity.ALERT],
      ['alert', Severity.ALERT],
      ['WARNING', Severity.WARNING],
      ['warning', Severity.WARNING],
    ])('chuẩn hoá "%s" → %p', (input, expected) => {
      expect(severityFromString(input)).toBe(expected);
    });

    // Chuỗi lạ rơi về NORMAL là hành vi CỐ Ý: payload hỏng từ Jetson không được
    // phép biến thành cảnh báo giả.
    it.each([undefined, null, '', 'DANGER', 'safe', 'NORMAL'])(
      'chuỗi không nhận dạng được (%p) → NORMAL',
      (input) => {
        expect(severityFromString(input as any)).toBe(Severity.NORMAL);
      },
    );
  });

  describe('severityToStatus', () => {
    // Phân biệt then chốt: null = "chưa có tín hiệu nào để đánh giá",
    // khác hẳn NORMAL = "đã đánh giá và an toàn". Gộp hai cái này lại sẽ khiến
    // trạm mất kết nối bị hiển thị là an toàn.
    it('null → "unknown", KHÔNG phải "safe"', () => {
      expect(severityToStatus(null)).toBe('unknown');
      expect(severityToStatus(Severity.NORMAL)).toBe('safe');
    });

    it.each([
      [Severity.NORMAL, 'safe'],
      [Severity.WARNING, 'warning'],
      [Severity.ALERT, 'danger'],
      [Severity.CRITICAL, 'critical'],
    ])('%p → "%s"', (severity, expected) => {
      expect(severityToStatus(severity)).toBe(expected);
    });

    it('giá trị ngoài enum rơi về "safe"', () => {
      expect(severityToStatus(99 as Severity)).toBe('safe');
    });
  });

  // Nhãn phải khớp SEVERITY_TO_STATUS bên frontend (lib/statusConfig.js).
  it('SEVERITY_STATUS_MAP phủ đúng 4 mức', () => {
    expect(Object.keys(SEVERITY_STATUS_MAP)).toHaveLength(4);
    expect(SEVERITY_STATUS_MAP).toEqual({
      [Severity.NORMAL]: 'safe',
      [Severity.WARNING]: 'warning',
      [Severity.ALERT]: 'danger',
      [Severity.CRITICAL]: 'critical',
    });
  });
});
