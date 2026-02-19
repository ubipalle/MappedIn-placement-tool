export interface Camera {
  id: string;
  mountType: string; // Mount type ID
  latitude: number;
  longitude: number;
  rotation: number; // Degrees from north (0-360)
  fieldOfView: number; // Degrees
  range: number; // Meters
  height: number; // Height above floor in meters
  tilt: number; // Vertical tilt angle in degrees (0 = horizontal, -90 = straight down)
  name: string;
  floorId?: string;
}

export interface CameraPlacement {
  cameras: Camera[];
}

export interface ViewingCone {
  cameraId: string;
  vertices: Array<{ latitude: number; longitude: number }>;
}
