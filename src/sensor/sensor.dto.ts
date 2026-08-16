import { IsNumber, IsOptional, IsString } from 'class-validator';

export class SensorDataDto {
  @IsOptional()
  @IsString()
  clusterId?: string;  // ID cụm cảm biến (backward compatible, fallback 'sensor_node_1')

  @IsOptional()
  @IsString()
  stationId?: string;  // Mã trạm liên kết với cụm cảm biến (STA-001-01)

  @IsOptional()
  @IsString()
  damId?: string;      // Mã đập (DAM-001)

  @IsNumber()
  freq: number;

  @IsNumber()
  amp: number;

  @IsNumber()
  waterLevel: number;

  @IsNumber()
  moisture: number;

  @IsOptional()
  @IsNumber()
  percent?: number;

  constructor(
    freq: number,
    amp: number,
    waterLevel: number,
    moisture: number,
    percent?: number,
    clusterId?: string,
    stationId?: string,
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
  stationId?: string;
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

export interface StationStatusChangeEvent {
  level: 'station' | 'dam';
  stationId?: string;
  damId: string;
  status: string; // 'safe' | 'warning' | 'danger' | 'critical' | 'unknown'
  statusReason?: string;
  severity: number;
  timestamp: string;
}

export interface DamMetricChangeEvent {
  damId: string;
  waterLevel: number;
  fillPct: number;
  timestamp: string;
}
