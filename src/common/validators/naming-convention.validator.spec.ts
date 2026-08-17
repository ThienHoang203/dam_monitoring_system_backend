import { BadRequestException } from '@nestjs/common';
import {
  ID_PATTERNS,
  validateDeviceId,
  normalizeSensorType,
  validateSensorType,
  validateCameraType,
} from './naming-convention.validator';

/**
 * Quy tắc đặt tên A.3.2 là hợp đồng giữa backend, firmware ESP32 và Jetson TX2.
 * ID sai chuẩn lọt vào DB nghĩa là thiết bị vật lý không nhận được config qua MQTT.
 */
describe('naming-convention.validator', () => {
  describe('validateDeviceId — ID hợp lệ', () => {
    it.each([
      ['DAM', 'DAM-001'],
      ['DAM', 'DAM-999'],
      ['STATION', 'STA-001-01'],
      ['STATION', 'STA-123-99'],
      ['GATEWAY', 'GTW-ST01-TX2A'],
      ['GATEWAY', 'GTW-ST99-TX2Z'],
      ['NODE', 'NOD-GW01-ESP01'],
      ['SENSOR', 'SNR-VIB-ESP01-I2C1'],
      ['SENSOR', 'SNR-WTL-ESP01-P01'],
      ['SENSOR', 'SNR-TLT-ESP02-ADC1'],
      ['SENSOR', 'SNR-MST-ESP01-P02'],
      ['SENSOR', 'SNR-US-ESP01-P03'],
      ['CAMERA', 'CAM-CSI-ST01-01'],
      ['CAMERA', 'CAM-IP-ST01-02'],
    ])('%s: "%s" được chấp nhận', (type, id) => {
      expect(() => validateDeviceId(type as keyof typeof ID_PATTERNS, id)).not.toThrow();
    });
  });

  describe('validateDeviceId — ID sai chuẩn', () => {
    it.each([
      ['DAM', 'DAM-1', 'thiếu số 0 đệm'],
      ['DAM', 'DAM-0001', 'thừa chữ số'],
      ['DAM', 'dam-001', 'chữ thường'],
      ['DAM', 'DAM001', 'thiếu dấu gạch'],
      ['STATION', 'STA-001-1', 'nhóm cuối chỉ 1 chữ số'],
      ['STATION', 'STA-0001-01', 'mã đập sai độ dài'],
      ['STATION', 'STA-001', 'thiếu nhóm trạm'],
      ['GATEWAY', 'GTW-st01-TX2A', 'chữ thường'],
      ['GATEWAY', 'GTW-ST_01-TX2A', 'ký tự gạch dưới'],
      ['GATEWAY', 'GTW-ST01', 'thiếu nhóm thiết bị'],
      ['NODE', 'NOD-GW01', 'thiếu nhóm ESP'],
      ['SENSOR', 'SNR-XXX-ESP01-P01', 'mã loại cảm biến không hợp lệ'],
      ['SENSOR', 'SNR-VIB-ESP01', 'thiếu cổng'],
      ['CAMERA', 'CAM-USB-ST01-01', 'loại camera không hợp lệ'],
      ['CAMERA', 'CAM-CSI-ST01', 'thiếu số thứ tự'],
    ])('%s: "%s" bị từ chối (%s)', (type, id) => {
      expect(() => validateDeviceId(type as keyof typeof ID_PATTERNS, id)).toThrow(BadRequestException);
    });

    it.each<[string | undefined | null, string]>([
      ['', 'chuỗi rỗng'],
      [undefined, 'undefined'],
      [null, 'null'],
    ])(
      'giá trị %p bị từ chối (%s)',
      (id) => {
        expect(() => validateDeviceId('DAM', id as any)).toThrow(BadRequestException);
      },
    );

    it('thông báo lỗi nêu rõ format yêu cầu để người dùng sửa được', () => {
      expect(() => validateDeviceId('DAM', 'DAM-1')).toThrow(
        /không đúng chuẩn DAM.*Format yêu cầu/,
      );
    });
  });

  describe('normalizeSensorType', () => {
    it.each([
      ['vibration', 'VIB'],
      ['VIBRATION', 'VIB'],
      ['tilt', 'TLT'],
      ['water_level', 'WTL'],
      ['waterlevel', 'WTL'],
      ['water', 'WTL'],
      ['moisture', 'MST'],
      ['humidity', 'MST'],
      ['ultrasonic', 'US'],
    ])('quy đổi tên dài "%s" → "%s"', (input, expected) => {
      expect(normalizeSensorType(input)).toBe(expected);
    });

    it.each(['VIB', 'TLT', 'WTL', 'MST', 'US'])('giữ nguyên mã đã chuẩn "%s"', (code) => {
      expect(normalizeSensorType(code)).toBe(code);
    });

    it('trim và viết hoa trước khi tra cứu', () => {
      expect(normalizeSensorType('  Humidity  ')).toBe('MST');
      expect(normalizeSensorType('Water_Level')).toBe('WTL');
    });

    // Trả nguyên chuỗi (in hoa) thay vì throw — để validateSensorType báo lỗi
    // với thông điệp rõ ràng hơn, kèm danh sách mã hợp lệ.
    it('trả nguyên chuỗi in hoa khi không nhận ra', () => {
      expect(normalizeSensorType('foo')).toBe('FOO');
    });

    it.each([['', ''], [undefined, ''], [null, '']])(
      'giá trị rỗng %p → ""',
      (input, expected) => {
        expect(normalizeSensorType(input as any)).toBe(expected);
      },
    );
  });

  describe('validateSensorType', () => {
    it.each(['VIB', 'TLT', 'WTL', 'MST', 'US'])('chấp nhận "%s"', (code) => {
      expect(() => validateSensorType(code)).not.toThrow();
    });

    // Chứng minh thứ tự bắt buộc: phải normalize TRƯỚC rồi mới validate,
    // đúng như NodeService.addSensor đang làm.
    it('từ chối tên dài chưa qua normalize', () => {
      expect(() => validateSensorType('HUMIDITY')).toThrow(BadRequestException);
      expect(() => validateSensorType(normalizeSensorType('HUMIDITY'))).not.toThrow();
    });

    it.each(['vib', 'FOO', ''])('từ chối "%s"', (code) => {
      expect(() => validateSensorType(code)).toThrow(BadRequestException);
    });
  });

  describe('validateCameraType', () => {
    it.each(['CSI', 'IP'])('chấp nhận "%s"', (code) => {
      expect(() => validateCameraType(code)).not.toThrow();
    });

    it.each(['csi', 'ip', 'USB', 'RTSP', ''])('từ chối "%s"', (code) => {
      expect(() => validateCameraType(code)).toThrow(BadRequestException);
    });
  });
});
