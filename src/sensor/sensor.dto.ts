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

export class UpdateThresholdDto {
  warnHigh?: number;
  alertHigh?: number;
  criticalHigh?: number;
  warnLow?: number;
  alertLow?: number;
  tankHeight?: number;
  sustainedSeconds?: number;
}
