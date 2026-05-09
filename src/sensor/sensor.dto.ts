export class SensorDataDto {
    freq: number;
    amp: number;
    waterLevel: number;
    moisture: number;
    percent?: number;
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