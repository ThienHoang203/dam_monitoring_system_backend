import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateNodeDto {
  // Mã node theo chuẩn NOD-[GW_SEQ]-ESP[SEQ], gắn theo Gateway. Bỏ trống thì backend tự sinh.
  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  macAddress?: string;

  @IsOptional()
  @IsString()
  espMacAddress?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  installLocation?: string;

  @IsOptional()
  @IsNumber()
  vibrationThreshold?: number;

  @IsOptional()
  @IsNumber()
  warnHigh?: number;

  @IsOptional()
  @IsNumber()
  criticalHigh?: number;

  @IsOptional()
  @IsNumber()
  alertMinCount?: number;

  @IsOptional()
  @IsNumber()
  alertMinDurationSec?: number;

  @IsOptional()
  @IsNumber()
  episodeResetGapSec?: number;

  @IsOptional()
  @IsString()
  gatewayId?: string;

  // Mã trạm cha (STA-001-01) — service tự resolve sang gateway tương ứng.
  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsString()
  mappedCameraId?: string;
}

export class UpdateNodeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  macAddress?: string;

  @IsOptional()
  @IsString()
  espMacAddress?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  installLocation?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  vibrationThreshold?: number;

  @IsOptional()
  @IsNumber()
  warnHigh?: number;

  @IsOptional()
  @IsNumber()
  criticalHigh?: number;

  @IsOptional()
  @IsNumber()
  alertMinCount?: number;

  @IsOptional()
  @IsNumber()
  alertMinDurationSec?: number;

  @IsOptional()
  @IsNumber()
  episodeResetGapSec?: number;

  @IsOptional()
  @IsString()
  gatewayId?: string;

  // Mã trạm cha (STA-001-01) — service tự resolve sang gateway tương ứng.
  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsString()
  mappedCameraId?: string;
}

export class CreateSensorDto {
  // Mã cảm biến theo chuẩn SNR-[SENSOR_TYPE]-[NODE_SEQ]-[PORT].
  // Bỏ trống thì backend tự sinh từ loại cảm biến + mã node + cổng.
  @IsOptional()
  @IsString()
  sensorId?: string;

  // Cổng phần cứng dùng trong mã (I2C1, ADC1...). Bỏ trống thì sinh P01, P02...
  @IsOptional()
  @IsString()
  port?: string;

  // Chấp nhận cả mã chuẩn (VIB/WTL/MST...) lẫn tên dài (vibration/water_level/humidity).
  @IsString()
  sensorType: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  calibrationOffset?: number;
}

export class UpdateSensorDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  calibrationOffset?: number;
}
