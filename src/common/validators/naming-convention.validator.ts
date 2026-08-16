import { BadRequestException } from '@nestjs/common';

/**
 * Naming Convention Validator (Spec A.3)
 *
 * Regex patterns and validation for all IoT device IDs.
 * Every device must follow the standardized naming format
 * before being registered in the system.
 */

export const ID_PATTERNS = {
  DAM: /^DAM-\d{3}$/,
  STATION: /^STA-\d{3}-\d{2}$/,
  GATEWAY: /^GTW-[A-Z0-9]+-[A-Z0-9]+$/,
  NODE: /^NOD-[A-Z0-9]+-[A-Z0-9]+$/,
  SENSOR: /^SNR-(VIB|TLT|WTL|MST|US)-[A-Z0-9]+-[A-Z0-9]+$/,
  CAMERA: /^CAM-(CSI|IP)-[A-Z0-9]+-[A-Z0-9]+$/,
};

export const SENSOR_TYPE_CODES = ['VIB', 'TLT', 'WTL', 'MST', 'US'] as const;
export type SensorTypeCode = (typeof SENSOR_TYPE_CODES)[number];

export const CAMERA_TYPE_CODES = ['CSI', 'IP'] as const;
export type CameraTypeCode = (typeof CAMERA_TYPE_CODES)[number];

/**
 * Validate a device ID against its expected naming convention regex.
 * Throws BadRequestException if the ID doesn't match.
 */
export function validateDeviceId(
  type: keyof typeof ID_PATTERNS,
  id: string,
): void {
  if (!id || !ID_PATTERNS[type].test(id)) {
    throw new BadRequestException(
      `ID "${id}" không đúng chuẩn ${type}. Format yêu cầu: ${ID_PATTERNS[type].source}`,
    );
  }
}

/**
 * Quy đổi tên loại cảm biến dạng dài mà UI/MQTT hay dùng ('water_level', 'humidity',
 * 'vibration'...) về mã 3 ký tự của chuẩn A.3.2. Mã hợp lệ sẵn thì giữ nguyên.
 * Trả lại nguyên chuỗi nếu không nhận ra, để validateSensorType() báo lỗi rõ ràng.
 */
export function normalizeSensorType(type: string): string {
  const t = (type || '').trim().toUpperCase();
  if (SENSOR_TYPE_CODES.includes(t as SensorTypeCode)) return t;

  switch (t) {
    case 'VIBRATION':
      return 'VIB';
    case 'TILT':
      return 'TLT';
    case 'WATER_LEVEL':
    case 'WATERLEVEL':
    case 'WATER':
      return 'WTL';
    case 'MOISTURE':
    case 'HUMIDITY':
      return 'MST';
    case 'ULTRASONIC':
      return 'US';
    default:
      return t;
  }
}

/**
 * Validate that a sensor type code is one of the allowed values.
 */
export function validateSensorType(type: string): void {
  if (!SENSOR_TYPE_CODES.includes(type as SensorTypeCode)) {
    throw new BadRequestException(
      `Loại cảm biến "${type}" không hợp lệ. Cho phép: ${SENSOR_TYPE_CODES.join(', ')}`,
    );
  }
}

/**
 * Validate that a camera type code is one of the allowed values.
 */
export function validateCameraType(type: string): void {
  if (!CAMERA_TYPE_CODES.includes(type as CameraTypeCode)) {
    throw new BadRequestException(
      `Loại camera "${type}" không hợp lệ. Cho phép: ${CAMERA_TYPE_CODES.join(', ')}`,
    );
  }
}
