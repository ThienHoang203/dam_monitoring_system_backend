export class CreateNodeDto {
  id?: string; // e.g. NOD-ST01-ESP01
  name: string;
  macAddress?: string;
  espMacAddress?: string;
  description?: string;
  firmwareVersion?: string;
  installLocation?: string;
  vibrationThreshold?: number; // alert_high
  warnHigh?: number;
  criticalHigh?: number;
  alertMinCount?: number;
  alertMinDurationSec?: number;
  episodeResetGapSec?: number;
  gatewayId?: string;
  stationId?: number;
  mappedCameraId?: string;
}

export class UpdateNodeDto {
  name?: string;
  macAddress?: string;
  espMacAddress?: string;
  description?: string;
  firmwareVersion?: string;
  installLocation?: string;
  status?: string;
  vibrationThreshold?: number; // alert_high
  warnHigh?: number;
  criticalHigh?: number;
  alertMinCount?: number;
  alertMinDurationSec?: number;
  episodeResetGapSec?: number;
  gatewayId?: string;
  stationId?: number;
  mappedCameraId?: string;
}

export class CreateSensorDto {
  id: string; // Must match ^SNR-(VIB|TLT|WTL|MST|US)-[A-Z0-9]+-[A-Z0-9]+$
  sensorType: string; // VIB | TLT | WTL | MST | US
  model?: string;
  unit?: string;
  calibrationOffset?: number;
}

export class UpdateSensorDto {
  model?: string;
  unit?: string;
  status?: string;
  calibrationOffset?: number;
}
