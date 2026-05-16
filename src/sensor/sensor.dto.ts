export class SensorDataDto {
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
  ) {
    this.freq = freq;
    this.amp = amp;
    this.waterLevel = waterLevel;
    this.moisture = moisture;
    this.percent = percent;
  }
}

export interface SensorSnapshot extends SensorDataDto {
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
