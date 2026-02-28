# Complete Setup Guide - Mappedin Camera Placement Tool

This guide contains ALL the code you need to recreate the project from scratch.

## Step 1: Create Project Structure

```bash
mkdir mappedin-camera-tool
cd mappedin-camera-tool
```

## Step 2: Create package.json

**File: `package.json`**

```json
{
  "name": "mappedin-camera-tool",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@mappedin/react-sdk": "^6.1.1",
    "next": "15.1.6",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.1"
  }
}
```

## Step 3: Configuration Files

**File: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**File: `tailwind.config.js`**

```javascript
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: { extend: {} },
  plugins: [],
}
```

**File: `postcss.config.js`**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

**File: `next.config.js`**

```javascript
const nextConfig = {
  reactStrictMode: true,
}
module.exports = nextConfig
```

## Step 4: Types

**File: `types/camera.ts`**

```typescript
export interface Camera {
  id: string;
  latitude: number;
  longitude: number;
  rotation: number;
  fieldOfView: number;
  range: number;
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
```

## Step 5: Utility Functions

**File: `utils/geometry.ts`**

```typescript
import { Camera } from '@/types/camera';

export function calculateViewingCone(
  camera: Camera,
  segments: number = 20
): Array<{ latitude: number; longitude: number }> {
  const { latitude, longitude, rotation, fieldOfView, range } = camera;
  const fovRad = (fieldOfView * Math.PI) / 180;
  const rotationRad = (rotation * Math.PI) / 180;
  const startAngle = rotationRad - fovRad / 2;
  const endAngle = rotationRad + fovRad / 2;
  
  const vertices: Array<{ latitude: number; longitude: number }> = [
    { latitude, longitude }
  ];
  
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / segments);
    const point = destinationPoint(latitude, longitude, range, angle);
    vertices.push(point);
  }
  
  vertices.push({ latitude, longitude });
  return vertices;
}

function destinationPoint(
  lat: number,
  lng: number,
  distance: number,
  bearing: number
): { latitude: number; longitude: number } {
  const R = 6371000;
  const δ = distance / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(bearing)
  );
  
  const λ2 = λ1 + Math.atan2(
    Math.sin(bearing) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  
  return {
    latitude: (φ2 * 180) / Math.PI,
    longitude: (λ2 * 180) / Math.PI
  };
}

export function generateCameraId(): string {
  return `camera_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function calculateAngle(
  centerLat: number,
  centerLng: number,
  pointLat: number,
  pointLng: number
): number {
  const dLng = pointLng - centerLng;
  const dLat = pointLat - centerLat;
  let angle = Math.atan2(dLng, dLat) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}
```

## Step 6: App Structure

**File: `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

**File: `app/layout.tsx`**

```typescript
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mappedin Camera Placement Tool',
  description: 'Interactive tool for placing cameras on Mappedin maps',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

## Step 7: Main Component (Part 1 of 2)

**File: `components/MapView.tsx`** (FIRST HALF)

```typescript
'use client';

import React, { useRef, useEffect, useState } from 'react';
import { MapView as MappedInMapView, useMapData } from '@mappedin/react-sdk';
import '@mappedin/react-sdk/lib/esm/index.css';
import { Camera } from '@/types/camera';
import { calculateViewingCone, generateCameraId } from '@/utils/geometry';

interface MapViewProps {
  apiKey: string;
  apiSecret: string;
  mapId: string;
  defaultFOV?: number;
  defaultRange?: number;
}

export default function MapView({
  apiKey,
  apiSecret,
  mapId,
  defaultFOV = 90,
  defaultRange = 10
}: MapViewProps) {
  const { mapData, isLoading, error } = useMapData({
    key: apiKey,
    secret: apiSecret,
    mapId: mapId,
  });

  const mapViewRef = useRef<any>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState(false);
  const [polygons, setPolygons] = useState<any[]>([]);

  useEffect(() => {
    if (!mapViewRef.current || !placementMode) return;

    const handleMapClick = (event: any) => {
      if (!event.coordinate) return;

      const newCamera: Camera = {
        id: generateCameraId(),
        latitude: event.coordinate.latitude,
        longitude: event.coordinate.longitude,
        rotation: 0,
        fieldOfView: defaultFOV,
        range: defaultRange,
        name: `Camera ${cameras.length + 1}`,
      };

      setCameras(prev => [...prev, newCamera]);
      setSelectedCamera(newCamera.id);
      setPlacementMode(false);
    };

    mapViewRef.current.on('click', handleMapClick);

    return () => {
      if (mapViewRef.current) {
        mapViewRef.current.off('click', handleMapClick);
      }
    };
  }, [mapViewRef.current, placementMode, cameras.length, defaultFOV, defaultRange]);

  useEffect(() => {
    if (!mapViewRef.current || !mapData) return;

    polygons.forEach(polygon => {
      try {
        mapViewRef.current.Polygons?.remove(polygon);
      } catch (e) {}
    });
    setPolygons([]);

    const newPolygons: any[] = [];

    cameras.forEach(camera => {
      try {
        const vertices = calculateViewingCone(camera);

        const polygon = mapViewRef.current.Polygons?.add({
          coordinates: vertices.map(v => ({
            latitude: v.latitude,
            longitude: v.longitude
          })),
          fillColor: camera.id === selectedCamera ? '#3b82f680' : '#3b82f640',
          strokeColor: camera.id === selectedCamera ? '#2563eb' : '#3b82f6',
          strokeWidth: 2,
        });

        if (polygon) newPolygons.push(polygon);

        const marker = mapViewRef.current.Markers?.add({
          coordinate: {
            latitude: camera.latitude,
            longitude: camera.longitude
          },
          rank: 'always-visible',
          appearance: {
            marker: {
              icon: `
                <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="8" fill="${camera.id === selectedCamera ? '#2563eb' : '#3b82f6'}" stroke="white" stroke-width="2"/>
                  <path d="M12 8 L12 16 M12 8 L10 10 M12 8 L14 10" stroke="white" stroke-width="2" stroke-linecap="round" transform="rotate(${camera.rotation} 12 12)"/>
                </svg>
              `
            }
          }
        });

        if (marker) newPolygons.push(marker);

        if (camera.id === selectedCamera) {
          const handleDistance = 3;
          const handleAngleRad = (camera.rotation * Math.PI) / 180;
          const R = 6371000;
          const δ = handleDistance / R;
          const φ1 = (camera.latitude * Math.PI) / 180;
          const λ1 = (camera.longitude * Math.PI) / 180;

          const φ2 = Math.asin(
            Math.sin(φ1) * Math.cos(δ) +
            Math.cos(φ1) * Math.sin(δ) * Math.cos(handleAngleRad)
          );
          const λ2 = λ1 + Math.atan2(
            Math.sin(handleAngleRad) * Math.sin(δ) * Math.cos(φ1),
            Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
          );

          const handleMarker = mapViewRef.current.Markers?.add({
            coordinate: {
              latitude: (φ2 * 180) / Math.PI,
              longitude: (λ2 * 180) / Math.PI
            },
            rank: 'always-visible',
            appearance: {
              marker: {
                icon: `
                  <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="6" fill="#10b981" stroke="white" stroke-width="2"/>
                  </svg>
                `
              }
            }
          });

          if (handleMarker) newPolygons.push(handleMarker);
        }
      } catch (error) {
        console.error('Error drawing camera:', error);
      }
    });

    setPolygons(newPolygons);
  }, [cameras, selectedCamera, mapData, mapViewRef.current]);
```

## Step 8: Main Component (Part 2 of 2)

**File: `components/MapView.tsx`** (SECOND HALF - CONTINUE FROM ABOVE)

```typescript
  const handleDeleteCamera = () => {
    if (selectedCamera) {
      setCameras(prev => prev.filter(c => c.id !== selectedCamera));
      setSelectedCamera(null);
    }
  };

  const handleUpdateCamera = (cameraId: string, updates: Partial<Camera>) => {
    setCameras(prev =>
      prev.map(camera =>
        camera.id === cameraId ? { ...camera, ...updates } : camera
      )
    );
  };

  const handleExport = () => {
    const dataStr = JSON.stringify({ cameras }, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'camera-placements.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">Loading map...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl text-red-600">Error: {error.message}</div>
      </div>
    );
  }

  const selectedCameraData = cameras.find(c => c.id === selectedCamera);

  return (
    <div className="flex h-screen">
      <div className="flex-1 relative">
        {mapData && (
          <MappedInMapView
            mapData={mapData}
            style={{ width: '100%', height: '100%' }}
            ref={mapViewRef}
          />
        )}

        <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg p-4 space-y-2">
          <button
            onClick={() => setPlacementMode(!placementMode)}
            className={`w-full px-4 py-2 rounded font-medium ${
              placementMode
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}
          >
            {placementMode ? 'Click to Place Camera' : 'Place Camera'}
          </button>
          <button
            onClick={handleExport}
            disabled={cameras.length === 0}
            className="w-full px-4 py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:bg-gray-300"
          >
            Export ({cameras.length})
          </button>
        </div>
      </div>

      <div className="w-80 bg-gray-50 border-l border-gray-200 overflow-y-auto">
        <div className="p-4">
          <h2 className="text-xl font-bold mb-4">Cameras</h2>

          {cameras.length === 0 && (
            <p className="text-gray-500 text-sm">
              Click "Place Camera" and then click on the map.
            </p>
          )}

          <div className="space-y-3">
            {cameras.map(camera => (
              <div
                key={camera.id}
                onClick={() => setSelectedCamera(camera.id)}
                className={`p-3 rounded-lg cursor-pointer ${
                  camera.id === selectedCamera
                    ? 'bg-blue-100 border-2 border-blue-500'
                    : 'bg-white border-2 border-transparent hover:border-gray-300'
                }`}
              >
                <div className="font-medium">{camera.name}</div>
                <div className="text-xs text-gray-600 mt-1">
                  FOV: {camera.fieldOfView}° | Range: {camera.range}m
                </div>
              </div>
            ))}
          </div>

          {selectedCameraData && (
            <div className="mt-6 p-4 bg-white rounded-lg border">
              <h3 className="font-bold mb-3">Edit Camera</h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input
                    type="text"
                    value={selectedCameraData.name}
                    onChange={e =>
                      handleUpdateCamera(selectedCameraData.id, { name: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    FOV: {selectedCameraData.fieldOfView}°
                  </label>
                  <input
                    type="range"
                    min="30"
                    max="180"
                    value={selectedCameraData.fieldOfView}
                    onChange={e =>
                      handleUpdateCamera(selectedCameraData.id, {
                        fieldOfView: parseInt(e.target.value)
                      })
                    }
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Range: {selectedCameraData.range}m
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    value={selectedCameraData.range}
                    onChange={e =>
                      handleUpdateCamera(selectedCameraData.id, {
                        range: parseInt(e.target.value)
                      })
                    }
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Rotation: {selectedCameraData.rotation.toFixed(0)}°
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={selectedCameraData.rotation}
                    onChange={e =>
                      handleUpdateCamera(selectedCameraData.id, {
                        rotation: parseInt(e.target.value)
                      })
                    }
                    className="w-full"
                  />
                </div>

                <button
                  onClick={handleDeleteCamera}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded font-medium hover:bg-red-700"
                >
                  Delete Camera
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

## Step 9: Main Page

**File: `app/page.tsx`**

```typescript
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen">
      <div className="text-xl">Initializing...</div>
    </div>
  ),
});

export default function Home() {
  const [credentials, setCredentials] = useState<{
    apiKey: string;
    apiSecret: string;
    mapId: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    apiKey: '',
    apiSecret: '',
    mapId: '',
    defaultFOV: '90',
    defaultRange: '10'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCredentials({
      apiKey: formData.apiKey,
      apiSecret: formData.apiSecret,
      mapId: formData.mapId,
    });
  };

  if (credentials) {
    return (
      <MapView
        apiKey={credentials.apiKey}
        apiSecret={credentials.apiSecret}
        mapId={credentials.mapId}
        defaultFOV={parseInt(formData.defaultFOV)}
        defaultRange={parseInt(formData.defaultRange)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold mb-2">Camera Placement Tool</h1>
        <p className="text-gray-600 mb-6">
          Place cameras on Mappedin maps with viewing cone visualization
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <input
              type="text"
              value={formData.apiKey}
              onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">API Secret</label>
            <input
              type="password"
              value={formData.apiSecret}
              onChange={e => setFormData({ ...formData, apiSecret: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Map ID</label>
            <input
              type="text"
              value={formData.mapId}
              onChange={e => setFormData({ ...formData, mapId: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700"
          >
            Load Map
          </button>
        </form>

        <div className="mt-4 text-xs text-center">
          <a
            href="https://developer.mappedin.com/docs/demo-keys-and-maps"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Get demo credentials
          </a>
        </div>
      </div>
    </div>
  );
}
```

## Step 10: Install and Run

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

## That's It!

You now have the complete code. When you're ready:

1. Create the folder structure
2. Copy each file's content into the correct location
3. Run `npm install`
4. Run `npm run dev`
5. Enter your Mappedin credentials

The field of view is whatever you specify (default 90°), and the viewing cone is calculated using geographic formulas for accuracy!
