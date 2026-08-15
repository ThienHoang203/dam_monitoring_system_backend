import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateGatewayDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  macAddress: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  stationId: number;
}

export class UpdateGatewayDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  macAddress?: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  stationId?: number;
}
