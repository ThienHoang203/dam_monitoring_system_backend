export class SensorDataDto {
  clusterId?: string;  // ID cụm cảm biến (backward compatible, fallback 'sensor_node_1')
  stationId?: number;  // ID trạm liên kết với cụm cảm biến
  damId?: string;      // ID đập (backward compatible, fallback 'dam_1')
  freq: number;
  amp: number;
  waterLevel: number;
  moisture: number;
  percent?: number;

  constructor(
    freq: number,
    amp: number,
    waterLevel: number,
    moisture: number,
    percent?: number,
    clusterId?: string,
    stationId?: number,
    damId?: string,
  ) {
    this.freq = freq;
    this.amp = amp;
    this.waterLevel = waterLevel;
    this.moisture = moisture;
    this.percent = percent;
    this.clusterId = clusterId;
    this.stationId = stationId;
    this.damId = damId;
  }
}

export interface SensorSnapshot extends SensorDataDto {
  stationId?: number;
  percent: number;
  timestamp: string;
}

export interface SensorHistory {
  timestamps: string[];
  freq: number[];
  amp: number[];
  waterLevel: number[];
  moisture: number[];
  percent: number[];
}

// Phát khi trạng thái an toàn tổng hợp của Station/Dam thay đổi (xem SensorService.recomputeStationStatus).
export interface StationStatusChangeEvent {
  level: 'station' | 'dam';
  stationId?: number;
  damId: string;
  status: string; // 'safe' | 'warning' | 'danger' | 'critical' | 'unknown'
  severity: number; // Severity enum value; -1 khi status = 'unknown' (không có tín hiệu nào còn tươi)
  timestamp: string;
}

// Phát khi một chỉ số tổng hợp cấp Dam thay đổi (xem SensorService.recomputeDamWaterLevel).
export interface DamMetricChangeEvent {
  damId: string;
  waterLevel: number; // MAX(waterLevel) trong các Station thuộc Dam
  timestamp: string;
}
