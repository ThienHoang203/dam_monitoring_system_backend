import { IsNumber, IsOptional, IsString } from 'class-validator';

export class SensorDataDto {
  @IsOptional()
  @IsString()
  clusterId?: string;  // ID cụm cảm biến (backward compatible, fallback 'sensor_node_1')

  @IsOptional()
  @IsNumber()
  stationId?: number;  // ID trạm liên kết với cụm cảm biến

  @IsOptional()
  @IsString()
  damId?: string;      // ID đập (backward compatible, fallback 'dam_1')

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

export interface StationStatusChangeEvent {
  level: 'station' | 'dam';
  stationId?: number;
  damId: string;
  status: string; // 'safe' | 'warning' | 'danger' | 'critical' | 'unknown'
  severity: number;
  timestamp: string;
}

export interface DamMetricChangeEvent {
  damId: string;
  waterLevel: number;
  fillPct: number;
  timestamp: string;
}
