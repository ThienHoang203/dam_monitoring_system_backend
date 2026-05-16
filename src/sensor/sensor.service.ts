import { Injectable } from '@nestjs/common';
import { SensorDataDto, SensorHistory, SensorSnapshot } from './sensor.dto';

const MAX_HISTORY = 60;

@Injectable()
export class SensorService {
  private latest: SensorSnapshot | null = null;

  private history: SensorHistory = {
    timestamps: [],
    freq: [],
    amp: [],
    waterLevel: [],
    moisture: [],
    percent: [],
  };

  ingest(dto: SensorDataDto): SensorSnapshot {
    const snapshot: SensorSnapshot = {
      freq: +dto.freq,
      amp: +dto.amp,
      waterLevel: +dto.waterLevel,
      moisture: +dto.moisture,
      percent:
        dto.percent != null
          ? +dto.percent
          : +((dto.waterLevel / 50) * 100).toFixed(1),
      timestamp: new Date().toISOString(),
    };

    this.latest = snapshot;
    this.pushHistory(snapshot);
    return snapshot;
  }

  getLatest(): SensorSnapshot | null {
    return this.latest;
  }

  getHistory(): SensorHistory {
    return this.history;
  }

  private pushHistory(s: SensorSnapshot) {
    const h = this.history;
    h.timestamps.push(s.timestamp);
    h.freq.push(s.freq);
    h.amp.push(s.amp);
    h.waterLevel.push(s.waterLevel);
    h.moisture.push(s.moisture);
    h.percent.push(s.percent);

    if (h.timestamps.length > MAX_HISTORY) {
      (Object.keys(h) as (keyof SensorHistory)[]).forEach((k) =>
        (h[k] as any[]).shift(),
      );
    }
  }
}
