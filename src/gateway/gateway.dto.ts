import { IsOptional, IsString } from 'class-validator';

export class CreateGatewayDto {
  // Mã gateway theo chuẩn GTW-[STATION_CODE]-[SEQ_ID].
  // Bỏ trống thì backend tự sinh từ STATION_CODE của trạm được chọn.
  @IsOptional()
  @IsString()
  gatewayId?: string;

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

  @IsOptional()
  @IsString()
  status?: string;

  // Mã trạm cha (STA-001-01) — service tự resolve sang khóa chính.
  @IsString()
  stationId: string;
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
  @IsString()
  stationId?: string;
}
