export interface Camera {
  id: string;
  model: 'UC2W' | 'UC2N'; // Camera model
  mountType: string; // Mount type ID (matches products.json)
  powerSource: string; // Power source type
  latitude: number;
  longitude: number;
  rotation: number; // Degrees from north (0-360)
  fieldOfView: number; // Degrees
  range: number; // Meters
  height: number; // Height above floor in meters
  tilt: number; // Vertical tilt angle in degrees (0 = horizontal, -90 = straight down)
  name: string;
  floorId?: string;
  room?: string; // Room/space name from MappedIn
}

export interface CameraPlacement {
  cameras: Camera[];
}

export interface ViewingCone {
  cameraId: string;
  vertices: Array<{ latitude: number; longitude: number }>;
}
