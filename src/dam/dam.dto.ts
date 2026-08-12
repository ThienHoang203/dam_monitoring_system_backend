export class CreateDamDto {
  id?: string;
  name: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  waterLevel?: number;
  flow?: number;
  fillPct?: number;
  status?: string;
}

export class UpdateDamDto {
  name?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  waterLevel?: number;
  flow?: number;
  fillPct?: number;
  status?: string;
}

export class CreateStationDto {
  name: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  river?: string;
  km?: string;
  status?: string;
  waterLevel?: number;
  change?: number;
  pressure?: number;
  flow?: number;
  humidity?: number;
  bd1?: number;
  bd2?: number;
  bd3?: number;
  damId: string;
}

export class UpdateStationDto {
  name?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  river?: string;
  km?: string;
  status?: string;
  waterLevel?: number;
  change?: number;
  pressure?: number;
  flow?: number;
  humidity?: number;
  bd1?: number;
  bd2?: number;
  bd3?: number;
  damId?: string;
}
