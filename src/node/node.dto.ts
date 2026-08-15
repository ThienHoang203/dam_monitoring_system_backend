import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateNodeDto {
  @IsOptional()
  @IsString()
  id?: string;

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

  @IsOptional()
  @IsNumber()
  stationId?: number;

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

  @IsOptional()
  @IsNumber()
  stationId?: number;

  @IsOptional()
  @IsString()
  mappedCameraId?: string;
}

export class CreateSensorDto {
  @IsString()
  id: string;

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
