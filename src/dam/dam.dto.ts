import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDamDto {
  // Mã đập theo chuẩn DAM-[XXX]. Bỏ trống thì backend tự sinh số thứ tự kế tiếp.
  @IsOptional()
  @IsString()
  damId?: string;

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
  // Mã trạm theo chuẩn STA-[DAM_CODE]-[XX]. Bỏ trống thì backend tự sinh từ mã đập cha.
  @IsOptional()
  @IsString()
  stationId?: string;

  // Mã ngắn dùng nhúng vào id gateway/node (ST01, ST02...). Bỏ trống thì backend tự sinh.
  @IsOptional()
  @IsString()
  stationCode?: string;

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
