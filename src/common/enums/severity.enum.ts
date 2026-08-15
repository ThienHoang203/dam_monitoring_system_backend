// Mức độ nghiêm trọng dùng chung để tổng hợp trạng thái an toàn của Node/Station/Dam.
// Thứ tự tăng dần theo mức nguy hiểm — dùng Math.max() để lấy "worst-case wins".
export enum Severity {
  NORMAL = 0,
  WARNING = 1,
  ALERT = 2,
  CRITICAL = 3,
}

// Khớp với SEVERITY_TO_STATUS bên frontend (lib/statusConfig.js) để hai bên không lệch nhãn hiển thị.
export const SEVERITY_STATUS_MAP: Record<Severity, string> = {
  [Severity.NORMAL]: 'safe',
  [Severity.WARNING]: 'warning',
  [Severity.ALERT]: 'danger',
  [Severity.CRITICAL]: 'critical',
};

export interface ThresholdLike {
  warnHigh?: number | null;
  alertHigh?: number | null;
  criticalHigh?: number | null;
}

// So khớp một giá trị đo được với cấu hình ngưỡng (ThresholdConfig), cùng cascade '>=' như frontend.
export function classifySeverity(value: number | null | undefined, config?: ThresholdLike | null): Severity {
  if (!config || value == null || isNaN(value)) return Severity.NORMAL;
  if (config.criticalHigh != null && value >= config.criticalHigh) return Severity.CRITICAL;
  if (config.alertHigh != null && value >= config.alertHigh) return Severity.ALERT;
  if (config.warnHigh != null && value >= config.warnHigh) return Severity.WARNING;
  return Severity.NORMAL;
}

// Chuẩn hoá chuỗi severity nhận từ Jetson TX2 (vibration_status/anomaly) hoặc AlarmEvent.severity.
export function severityFromString(value?: string | null): Severity {
  switch ((value || '').toUpperCase()) {
    case 'CRITICAL':
      return Severity.CRITICAL;
    case 'ALERT':
      return Severity.ALERT;
    case 'WARNING':
      return Severity.WARNING;
    default:
      return Severity.NORMAL;
  }
}

// severity = null nghĩa là "không có tín hiệu nào còn tươi để đánh giá" (xem recomputeStationStatus/
// recomputeDamStatus) — khác với Severity.NORMAL (đã đánh giá và an toàn).
export function severityToStatus(severity: Severity | null): string {
  if (severity == null) return 'unknown';
  return SEVERITY_STATUS_MAP[severity] ?? 'safe';
}
