export class CreateSensorClusterDto {
  id?: string;
  name: string;
  description?: string;
  espMacAddress?: string;
  firmwareVersion?: string;
  installLocation?: string;
  stationId: number;
  devices?: CreateSensorDeviceDto[];
}

export class UpdateSensorClusterDto {
  name?: string;
  description?: string;
  espMacAddress?: string;
  firmwareVersion?: string;
  installLocation?: string;
  status?: string;
  stationId?: number;
}

export class CreateSensorDeviceDto {
  sensorType: string; // 'water_level' | 'humidity' | 'vibration'
  model?: string;
  unit?: string;
  calibrationOffset?: number;
}

export class UpdateSensorDeviceDto {
  sensorType?: string;
  model?: string;
  status?: string;
  unit?: string;
  calibrationOffset?: number;
}
