import { IsOptional, IsString } from 'class-validator';

export class CreateCameraDto {
  // Mã camera theo chuẩn CAM-[CAM_TYPE]-[STATION_CODE]-[SEQ_ID].
  // Bỏ trống thì backend tự sinh từ loại camera + STATION_CODE của gateway cha.
  @IsOptional()
  @IsString()
  cameraId?: string;

  @IsString()
  cameraType: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  streamUrl?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsString()
  gatewayId: string;
}

export class UpdateCameraDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  streamUrl?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  // Chuyển camera sang gateway khác (mã gateway).
  @IsOptional()
  @IsString()
  gatewayId?: string;
}
