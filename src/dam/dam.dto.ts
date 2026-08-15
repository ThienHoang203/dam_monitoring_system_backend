import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDamDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  waterLevel?: number;

  @IsOptional()
  @IsNumber()
  flow?: number;

  @IsOptional()
  @IsNumber()
  fillPct?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  cameraUrl?: string;
}

export class UpdateDamDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  waterLevel?: number;

  @IsOptional()
  @IsNumber()
  flow?: number;

  @IsOptional()
  @IsNumber()
  fillPct?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  cameraUrl?: string;
}

export class CreateStationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  river?: string;

  @IsOptional()
  @IsString()
  km?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  waterLevel?: number;

  @IsOptional()
  @IsNumber()
  change?: number;

  @IsOptional()
  @IsNumber()
  pressure?: number;

  @IsOptional()
  @IsNumber()
  flow?: number;

  @IsOptional()
  @IsNumber()
  humidity?: number;

  @IsOptional()
  @IsNumber()
  bd1?: number;

  @IsOptional()
  @IsNumber()
  bd2?: number;

  @IsOptional()
  @IsNumber()
  bd3?: number;

  @IsString()
  damId: string;
}

export class UpdateStationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  river?: string;

  @IsOptional()
  @IsString()
  km?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  waterLevel?: number;

  @IsOptional()
  @IsNumber()
  change?: number;

  @IsOptional()
  @IsNumber()
  pressure?: number;

  @IsOptional()
  @IsNumber()
  flow?: number;

  @IsOptional()
  @IsNumber()
  humidity?: number;

  @IsOptional()
  @IsNumber()
  bd1?: number;

  @IsOptional()
  @IsNumber()
  bd2?: number;

  @IsOptional()
  @IsNumber()
  bd3?: number;

  @IsOptional()
  @IsString()
  damId?: string;
}
