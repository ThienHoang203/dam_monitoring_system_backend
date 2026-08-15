import { IsOptional, IsString } from 'class-validator';

export class CreateCameraDto {
  @IsString()
  id: string;

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
}
