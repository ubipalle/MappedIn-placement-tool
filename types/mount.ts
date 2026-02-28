export interface MountType {
  id: string;
  name: string;
  sku: string;
  description: string;
  snapsToWalls: boolean;
  useCeilingHeight: boolean;
  parameters: {
    range: number;
    height: number;
    tilt: number;
    rotation: number;
  };
  locked: {
    fieldOfView: boolean;
    range: boolean;
    height: boolean;
    tilt: boolean;
    rotation: boolean;
  };
}

export interface CameraModel {
  name: string;
  defaultFOV: number;
  verticalFOV: number;
  internalTilt: number;
  description: string;
}

export interface PowerSource {
  id: string;
  name: string;
  sku: string;
}

export interface MountConfig {
  mounts: MountType[];
  models: Record<string, CameraModel>;
  powerSources: PowerSource[];
}
