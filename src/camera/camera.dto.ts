export class CreateCameraDto {
  id: string; // Must match ^CAM-(CSI|IP)-[A-Z0-9]+-[A-Z0-9]+$
  cameraType: string; // 'CSI' | 'IP'
  name: string;
  streamUrl?: string; // Required if cameraType = 'IP'
  resolution?: string;
  gatewayId: string;
}

export class UpdateCameraDto {
  name?: string;
  streamUrl?: string;
  status?: string;
  resolution?: string;
}
