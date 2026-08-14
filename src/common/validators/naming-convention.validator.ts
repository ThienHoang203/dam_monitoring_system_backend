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
