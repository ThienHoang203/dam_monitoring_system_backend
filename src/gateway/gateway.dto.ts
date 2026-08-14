export class CreateGatewayDto {
  id: string; // Must match ^GTW-[A-Z0-9]+-[A-Z0-9]+$
  name: string;
  macAddress: string;
  firmwareVersion?: string;
  description?: string;
  stationId: number;
}

export class UpdateGatewayDto {
  name?: string;
  macAddress?: string;
  firmwareVersion?: string;
  description?: string;
  status?: string;
  stationId?: number;
}
