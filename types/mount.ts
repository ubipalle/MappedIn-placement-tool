export interface MountType {
  id: string;
  name: string;
  description?: string;
  snapsToWalls?: boolean;  // If true, camera snaps to nearest wall and rotation is set by wall orientation
  parameters: {
    fieldOfView: number;    // degrees
    range: number;          // meters
    height: number;         // meters
    tilt: number;           // degrees (-90 to 90)
    rotation?: number;      // degrees (0-360), optional default
  };
  locked: {
    fieldOfView?: boolean;  // If true, FOV cannot be adjusted
    range?: boolean;        // If true, range cannot be adjusted
    height?: boolean;       // If true, height cannot be adjusted
    tilt?: boolean;         // If true, tilt cannot be adjusted
    rotation?: boolean;     // If true, rotation cannot be adjusted
  };
}

export interface MountConfig {
  mounts: MountType[];
}
