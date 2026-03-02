'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { MapView as MappedInMapView, useMapData, useMap } from '@mappedin/react-sdk';
import { Camera } from '@/types/camera';
import { MountType, MountConfig } from '@/types/mount';
import { calculateViewingCone3D, generateCameraId, findClosestWall } from '@/utils/geometry';
import mountsConfig from '@/mounts.json';

interface MapViewProps {
  apiKey: string;
  apiSecret: string;
  mapId: string;
  defaultFOV?: number;
  defaultRange?: number;
  defaultHeight?: number;
  defaultTilt?: number;
}

// Helper: Calculate distance between two lat/lng points in meters
function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371e3; 
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Detect which room/space a coordinate belongs to using point-in-polygon.
 */
function detectRoom(lat: number, lng: number, mapData: any): string | undefined {
  if (!mapData) return undefined;
  const spaces = mapData.getByType ? mapData.getByType('space') : [];
  if (!spaces) return undefined;

  for (const space of spaces) {
    const geoJSON = space.geoJSON;
    if (!geoJSON?.geometry?.coordinates) continue;

    const polygons = geoJSON.geometry.type === 'MultiPolygon'
      ? geoJSON.geometry.coordinates
      : [geoJSON.geometry.coordinates];

    for (const ring of polygons) {
      const coords = ring[0];
      if (coords && pointInPolygon(lat, lng, coords)) {
        return space.name || space.id || undefined;
      }
    }
  }
  return undefined;
}

/**
 * Get ceiling height for a coordinate from MappedIn space data.
 * Falls back to floor height, then default 3.0m.
 */
function getCeilingHeight(lat: number, lng: number, mapData: any): number | null {
  if (!mapData) return null;
  const spaces = mapData.getByType ? mapData.getByType('space') : [];
  if (!spaces) return null;

  for (const space of spaces) {
    const geoJSON = space.geoJSON;
    if (!geoJSON?.geometry?.coordinates) continue;

    const polygons = geoJSON.geometry.type === 'MultiPolygon'
      ? geoJSON.geometry.coordinates
      : [geoJSON.geometry.coordinates];

    for (const ring of polygons) {
      const coords = ring[0];
      if (coords && pointInPolygon(lat, lng, coords)) {
        // Try space height properties (MappedIn SDK)
        if (typeof space.height === 'number' && space.height > 0) return space.height;
        if (space.properties?.height) return parseFloat(space.properties.height);
        if (geoJSON.properties?.height) return parseFloat(geoJSON.properties.height);
        // Try floor-level height
        if (space.floor?.height) return space.floor.height;
        return null;
      }
    }
  }
  return null;
}

/**
 * Ray casting point-in-polygon test.
 * coords is array of [lng, lat] pairs (GeoJSON order).
 */
function pointInPolygon(lat: number, lng: number, coords: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1];
    const xj = coords[j][0], yj = coords[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// --- LOGIC COMPONENT (No UI) ---
function MapContent({ 
  cameras, 
  selectedCamera, 
  onMapViewReady,
  mapData,
  dragGhost,
  placementMode,
  onPlaceCamera,
  onHoverCoord,
}: {
  cameras: Camera[];
  selectedCamera: string | null;
  onMapViewReady: (mapView: any) => void;
  mapData: any;
  dragGhost: { lat: number, lng: number } | null;
  placementMode: boolean;
  onPlaceCamera: (coord: { latitude: number, longitude: number }) => void;
  onHoverCoord: (coord: { latitude: number, longitude: number }) => void;
}) {
  const { mapView } = useMap();
  const shapesRef = useRef<any[]>([]);
  const ghostRef = useRef<any>(null);

  // 1. Expose mapView to Parent
  useEffect(() => {
    if (mapView) onMapViewReady(mapView);
  }, [mapView, onMapViewReady]);

  // 1b. Track hover coordinate from SDK (accurate map coordinates)
  useEffect(() => {
    if (!mapView) return;
    const onHover = (e: any) => {
      const coord = e.coordinate || e.latLng;
      if (coord) onHoverCoord(coord);
    };
    mapView.on('hover', onHover);
    return () => { mapView.off('hover', onHover); };
  }, [mapView, onHoverCoord]);

  // 2. Handle CLICK for Placement (Uses SDK Event for precision)
  useEffect(() => {
    if (!mapView || !placementMode) return;
    
    const onClick = (e: any) => {
        const coord = e.coordinate || e.latLng;
        if (coord) onPlaceCamera(coord);
    };
    
    mapView.on('click', onClick);
    return () => { mapView.off('click', onClick); };
  }, [mapView, placementMode, onPlaceCamera]);

  // 3. Draw Cameras & Cones
  useEffect(() => {
    if (!mapView || !mapData || !mapView.Shapes) return;

    // Clear static shapes
    shapesRef.current.forEach(shape => {
      try { mapView.Shapes.remove(shape); } catch (e) {}
    });
    shapesRef.current = [];

    cameras.forEach(camera => {
      try {
        const isSelected = camera.id === selectedCamera;
        
        const color = isSelected ? '#2563eb' : '#3b82f6';
        const baseOpacity = isSelected ? 0.35 : 0.2;
        
        // Draw Cone
        const coneLayers = calculateViewingCone3D(camera, 20, mapData);
        coneLayers.forEach((layer, index) => {
          const coordinates = layer.vertices.map(v => [v.longitude, v.latitude]);
          const geoJSON = {
            type: 'FeatureCollection' as const,
            features: [{
              type: 'Feature' as const,
              properties: {},
              geometry: { type: 'Polygon' as const, coordinates: [coordinates] }
            }]
          };
          const nextHeight = index < coneLayers.length - 1 ? coneLayers[index + 1].height : 0;
          let layerThickness = layer.height - nextHeight;
          if (layerThickness < 0.01) layerThickness = 0.01;
          const heightRatio = 1 - (layer.height / camera.height);
          
          const shape = mapView.Shapes.add(geoJSON, {
            color: color,
            opacity: baseOpacity * (0.3 + 0.7 * heightRatio),
            altitude: nextHeight,
            height: layerThickness
          });
          if (shape) shapesRef.current.push(shape);
        });

        // Draw Marker
        const markerSize = 0.00000045;
        const cameraMarker = {
          type: 'FeatureCollection' as const,
          features: [{
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[
                [camera.longitude - markerSize, camera.latitude - markerSize],
                [camera.longitude + markerSize, camera.latitude - markerSize],
                [camera.longitude + markerSize, camera.latitude + markerSize],
                [camera.longitude - markerSize, camera.latitude + markerSize],
                [camera.longitude - markerSize, camera.latitude - markerSize],
              ]]
            }
          }]
        };
        const marker = mapView.Shapes.add(cameraMarker, {
          color: isSelected ? '#dc2626' : '#ef4444',
          opacity: 1.0,
          altitude: camera.height - 0.05,
          height: 0.1
        });
        if (marker) shapesRef.current.push(marker);

      } catch (error) {
        console.error('Error drawing camera:', camera.id, error);
      }
    });
  }, [mapView, mapData, cameras, selectedCamera]);

  // 4. Draw Drag Ghost (Dynamic)
  useEffect(() => {
    if (!mapView || !mapView.Shapes) return;

    if (ghostRef.current) {
      try { mapView.Shapes.remove(ghostRef.current); } catch(e) {}
      ghostRef.current = null;
    }

    if (dragGhost) {
       const { lat, lng } = dragGhost;
       const markerSize = 0.00000060;
       const ghostGeoJSON = {
          type: 'FeatureCollection' as const,
          features: [{
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[
                [lng - markerSize, lat - markerSize],
                [lng + markerSize, lat - markerSize],
                [lng + markerSize, lat + markerSize],
                [lng - markerSize, lat + markerSize],
                [lng - markerSize, lat - markerSize],
              ]]
            }
          }]
       };
       try {
         ghostRef.current = mapView.Shapes.add(ghostGeoJSON, {
            color: '#f97316', // Orange
            opacity: 0.8,
            altitude: 2.5,
            height: 0.5
         });
       } catch(e) {}
    }
  }, [mapView, dragGhost]);

  return null;
}

// --- MAIN UI COMPONENT ---
export default function MapView({
  apiKey,
  apiSecret,
  mapId,
  defaultFOV = 90,
  defaultRange = 10,
  defaultHeight = 2.5,
  defaultTilt = -30
}: MapViewProps) {
  const { mapData, isLoading, error } = useMapData({
    key: apiKey,
    secret: apiSecret,
    mapId: mapId,
  });

  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState(false);
  const [currentMapView, setCurrentMapView] = useState<any>(null);
  const [selectedMount, setSelectedMount] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<'UC2W' | 'UC2N'>('UC2W');
  const [selectedPowerSource, setSelectedPowerSource] = useState<string>('poe-upa1');
  const [mounts, setMounts] = useState<MountType[]>([]);
  
  // Config data
  const config = mountsConfig as MountConfig;
  const models = config.models;
  const powerSources = config.powerSources;
  
  // Drag State
  const [dragGhost, setDragGhost] = useState<{ lat: number, lng: number } | null>(null);
  const dragGhostRef = useRef<{ lat: number, lng: number } | null>(null);
  const [cursorStyle, setCursorStyle] = useState<'default' | 'crosshair' | 'grab' | 'grabbing'>('default');
  
  // Refs
  const isDraggingRef = useRef<boolean>(false);
  const dragCameraIdRef = useRef<string | null>(null);
  const dragWallRef = useRef<{ coords: Array<[number, number]>, height: number } | null>(null);
  const wallsRef = useRef<Array<{ coords: Array<[number, number]>, height: number }>>([]);
  const lastThrottleTime = useRef<number>(0);
  const hoverCoordRef = useRef<{ latitude: number, longitude: number } | null>(null);
  const dragStartScreenRef = useRef<{ x: number, y: number } | null>(null);
  const dragStartLatLngRef = useRef<{ lat: number, lng: number } | null>(null);

  // Callback for SDK hover events — updates the latest map coordinate (only fires when mouse is NOT held)
  const handleHoverCoord = useCallback((coord: { latitude: number, longitude: number }) => {
    hoverCoordRef.current = coord;

    // Cursor feedback: show grab cursor when hovering near a camera
    if (!isDraggingRef.current && !placementMode) {
      const nearCamera = cameras.some(c => {
        const dist = getDistanceMeters(c.latitude, c.longitude, coord.latitude, coord.longitude);
        return dist < 2.5;
      });
      setCursorStyle(nearCamera ? 'grab' : 'default');
    }
  }, [cameras, placementMode]);

  /**
   * Convert screen pixel delta to lat/lng delta using the map's current zoom and bearing.
   * Uses standard Web Mercator math: metersPerPixel = 156543.03 * cos(lat) / 2^zoom
   */
  const screenDeltaToLatLng = useCallback((dx: number, dy: number, startLat: number, startLng: number) => {
    // Get map camera state
    const cam = currentMapView?.Camera;
    const zoom = cam?.zoom ?? cam?.zoomLevel ?? 18;
    const bearingDeg = cam?.bearing ?? cam?.rotation ?? 0;
    const bearingRad = bearingDeg * Math.PI / 180;

    const latRad = startLat * Math.PI / 180;
    const metersPerPixel = 156543.03392 * Math.cos(latRad) / Math.pow(2, zoom);

    const degLatPerPx = metersPerPixel / 111320;
    const degLngPerPx = metersPerPixel / (111320 * Math.cos(latRad));

    // Rotate screen delta by bearing:
    // Screen down (+dy) at bearing 0 = South (-lat)
    // Screen right (+dx) at bearing 0 = East (+lng)
    const newLat = startLat + (-dy * Math.cos(bearingRad) - dx * Math.sin(bearingRad)) * degLatPerPx;
    const newLng = startLng + (dx * Math.cos(bearingRad) - dy * Math.sin(bearingRad)) * degLngPerPx;

    return { lat: newLat, lng: newLng };
  }, [currentMapView]);

  // Load Mounts
  useEffect(() => {
    setMounts(config.mounts);
    if (config.mounts.length > 0) {
      setSelectedMount(config.mounts[0].id);
    }
  }, []);

  // Parse Walls
  useEffect(() => {
    if (!mapData) return;
    const spaces = mapData.getByType ? mapData.getByType('space') : [];
    const parsedWalls: Array<{ coords: Array<[number, number]>, height: number }> = [];
    if (spaces) {
      spaces.forEach((space: any) => {
        const geoJSON = space.geoJSON;
        if (geoJSON?.geometry?.coordinates) {
          // Try to get actual height from space data
          const spaceHeight = space.height || space.properties?.height || geoJSON.properties?.height || 3.0;
          const polygons = geoJSON.geometry.type === 'MultiPolygon' ? geoJSON.geometry.coordinates : [geoJSON.geometry.coordinates];
          polygons.forEach((ring: any[]) => {
            const coords = ring[0];
            if (coords && coords.length > 2) parsedWalls.push({ coords, height: parseFloat(spaceHeight) || 3.0 });
          });
        }
      });
    }
    wallsRef.current = parsedWalls;
  }, [mapData]);

  // --- HANDLERS ---

  // 1. Placement Handler
  const handlePlaceCamera = useCallback((coord: { latitude: number, longitude: number }) => {
    const mount = mounts.find(m => m.id === selectedMount);
    if (!mount) return;

    let finalLat = coord.latitude;
    let finalLng = coord.longitude;
    let finalRotation = mount.parameters.rotation || 0;

    if (mount.snapsToWalls) {
        const wallSnap = findClosestWall(finalLat, finalLng, wallsRef.current);
        if (wallSnap && wallSnap.distance * 111000 < 2.0) {
            finalLat = wallSnap.closestPoint[1];
            finalLng = wallSnap.closestPoint[0];
            const wallNormal = wallSnap.rotation;
            const mountOffset = mount.parameters.rotation || 0;
            finalRotation = (wallNormal + mountOffset) % 360;
        } else {
            alert('Please click closer to a wall.');
            return;
        }
    }

    // FOV and internal tilt come from the camera model
    const modelFOV = models[selectedModel]?.defaultFOV || defaultFOV;
    const modelVerticalFOV = models[selectedModel]?.verticalFOV || 44;
    const internalTilt = models[selectedModel]?.internalTilt ?? 0;

    // Detect room from map data
    const room = detectRoom(finalLat, finalLng, mapData);

    // Determine height: ceiling mounts use ceiling height from the map
    let cameraHeight = mount.parameters.height ?? defaultHeight;
    if (mount.useCeilingHeight) {
      const ceilingH = getCeilingHeight(finalLat, finalLng, mapData);
      if (ceilingH !== null) {
        cameraHeight = ceilingH;
      }
    }

    const newCamera: Camera = {
        id: generateCameraId(),
        model: selectedModel,
        mountType: selectedMount || '',
        powerSource: selectedPowerSource,
        latitude: finalLat,
        longitude: finalLng,
        rotation: finalRotation,
        fieldOfView: modelFOV,
        verticalFOV: modelVerticalFOV,
        range: mount.parameters.range ?? defaultRange,
        height: cameraHeight,
        tilt: mount.parameters.tilt ?? defaultTilt,
        internalTilt,
        name: `${selectedModel} ${cameras.length + 1}`,
        floorId: currentMapView?.currentFloor?.id,
        room,
    };

    setCameras(prev => [...prev, newCamera]);
    setSelectedCamera(newCamera.id);
    setPlacementMode(false);
  }, [selectedMount, selectedModel, selectedPowerSource, mounts, models, cameras, mapData, defaultFOV, defaultRange, defaultHeight, defaultTilt, currentMapView]);


  // 2. Mouse Down (Start Drag)
  const handleMouseDownCapture = (e: React.MouseEvent) => {
    if (placementMode || !currentMapView) return;

    const coord = hoverCoordRef.current;
    if (!coord) return;

    const clickedCamera = cameras.find(c => {
        const dist = getDistanceMeters(c.latitude, c.longitude, coord.latitude, coord.longitude);
        return dist < 2.5;
    });

    if (clickedCamera) {
        e.stopPropagation(); 
        e.preventDefault(); // Prevent SDK from starting a pan
        
        setSelectedCamera(clickedCamera.id);
        setCursorStyle('grabbing');

        // Store drag start positions for pixel-delta tracking
        dragStartScreenRef.current = { x: e.clientX, y: e.clientY };
        dragStartLatLngRef.current = { lat: clickedCamera.latitude, lng: clickedCamera.longitude };

        const mount = mounts.find(m => m.id === clickedCamera.mountType);

        if (mount?.snapsToWalls) {
            // Wall-mounted: find the wall it's on and constrain drag to it
            let bestWall = null;
            let bestDist = Infinity;
            wallsRef.current.forEach(wall => {
                const snap = findClosestWall(clickedCamera.latitude, clickedCamera.longitude, [wall]);
                if (snap && snap.distance < bestDist) {
                    bestDist = snap.distance;
                    bestWall = wall;
                }
            });

            if (bestWall) {
                isDraggingRef.current = true;
                dragCameraIdRef.current = clickedCamera.id;
                dragWallRef.current = bestWall;
            }
        } else {
            // Ceiling-mounted or free: drag freely (no wall constraint)
            isDraggingRef.current = true;
            dragCameraIdRef.current = clickedCamera.id;
            dragWallRef.current = null;
        }
    }
  };

  // 3. Mouse Move (Compute drag ghost from pixel delta)
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !dragStartScreenRef.current || !dragStartLatLngRef.current) return;

    e.stopPropagation();
    e.preventDefault();

    const now = Date.now();
    if (now - lastThrottleTime.current < 20) return;
    lastThrottleTime.current = now;

    const dx = e.clientX - dragStartScreenRef.current.x;
    const dy = e.clientY - dragStartScreenRef.current.y;
    const raw = screenDeltaToLatLng(dx, dy, dragStartLatLngRef.current.lat, dragStartLatLngRef.current.lng);

    if (dragWallRef.current) {
      // Wall-mounted: snap the raw position to the wall
      const wallSnap = findClosestWall(raw.lat, raw.lng, [dragWallRef.current]);
      if (wallSnap) {
        const pos = { lat: wallSnap.closestPoint[1], lng: wallSnap.closestPoint[0] };
        dragGhostRef.current = pos;
        setDragGhost(pos);
      }
    } else {
      // Ceiling/free: follow cursor directly
      const pos = { lat: raw.lat, lng: raw.lng };
      dragGhostRef.current = pos;
      setDragGhost(pos);
    }
  };

  // 4. Mouse Up (Drop)
  const handleMouseUp = (e: React.MouseEvent) => {
    const ghost = dragGhostRef.current;
    if (isDraggingRef.current && dragCameraIdRef.current && ghost) {
        e.stopPropagation();

        const camId = dragCameraIdRef.current; // capture before reset
        const cam = cameras.find(c => c.id === camId);
        const mnt = mounts.find(m => m.id === cam?.mountType);

        if (dragWallRef.current) {
            // Wall-mounted: snap to wall and recalculate rotation
            const wallSnap = findClosestWall(ghost.lat, ghost.lng, [dragWallRef.current]);
            if (wallSnap) {
                const wallNormal = wallSnap.rotation;
                const mountOffset = mnt?.parameters.rotation || 0;
                const finalRotation = (wallNormal + mountOffset) % 360;
                const newRoom = detectRoom(ghost.lat, ghost.lng, mapData);

                setCameras(prev => prev.map(c => {
                    if (c.id === camId) {
                        return { ...c, latitude: ghost.lat, longitude: ghost.lng, rotation: finalRotation, room: newRoom };
                    }
                    return c;
                }));
            }
        } else {
            // Ceiling/free mount: move freely, update room and ceiling height
            const newRoom = detectRoom(ghost.lat, ghost.lng, mapData);
            let newHeight = cam?.height;
            if (mnt?.useCeilingHeight) {
                const ceilingH = getCeilingHeight(ghost.lat, ghost.lng, mapData);
                if (ceilingH !== null) newHeight = ceilingH;
            }

            setCameras(prev => prev.map(c => {
                if (c.id === camId) {
                    return { ...c, latitude: ghost.lat, longitude: ghost.lng, room: newRoom, height: newHeight ?? c.height };
                }
                return c;
            }));
        }
    }

    // Reset
    isDraggingRef.current = false;
    dragCameraIdRef.current = null;
    dragWallRef.current = null;
    dragStartScreenRef.current = null;
    dragStartLatLngRef.current = null;
    dragGhostRef.current = null;
    setDragGhost(null);
    setCursorStyle(placementMode ? 'crosshair' : 'default');
  };

  // Helpers
  const handleDeleteCamera = () => {
    if (selectedCamera) {
      setCameras(prev => prev.filter(c => c.id !== selectedCamera));
      setSelectedCamera(null);
    }
  };
  
  const handleUpdateCamera = (id: string, updates: Partial<Camera>) => {
    setCameras(prev => prev.map(c => {
      if (c.id !== id) return c;
      const updated = { ...c, ...updates };
      // If model changed, update FOV, verticalFOV, and internalTilt to match
      if (updates.model && models[updates.model]) {
        updated.fieldOfView = models[updates.model].defaultFOV;
        updated.verticalFOV = models[updates.model].verticalFOV;
        updated.internalTilt = models[updates.model].internalTilt;
      }
      // If mount type changed, reset locked parameters to mount defaults
      if (updates.mountType) {
        const newMount = mounts.find(m => m.id === updates.mountType);
        const oldMount = mounts.find(m => m.id === c.mountType);
        if (newMount) {
          const locked = newMount.locked;
          if (locked.tilt) updated.tilt = newMount.parameters.tilt;
          if (locked.height) {
            if (newMount.useCeilingHeight) {
              const ceilingH = getCeilingHeight(c.latitude, c.longitude, mapData);
              updated.height = ceilingH ?? newMount.parameters.height;
            } else {
              updated.height = newMount.parameters.height;
            }
          }
          if (locked.rotation) {
            // For wall-snap mounts, rotation is wall normal + mount offset.
            // When switching between wall mounts, adjust for the offset difference
            // rather than resetting to the raw mount offset.
            if (newMount.snapsToWalls && oldMount?.snapsToWalls) {
              const oldOffset = oldMount.parameters.rotation || 0;
              const newOffset = newMount.parameters.rotation || 0;
              updated.rotation = ((c.rotation - oldOffset + newOffset) + 360) % 360;
            } else {
              updated.rotation = newMount.parameters.rotation;
            }
          }
          if (locked.range) updated.range = newMount.parameters.range;
        }
      }
      return updated;
    }));
  };
  
  const handleCameraView = (viewType: 'top' | 'angle' | 'side' | 'rotate') => {
    if (!currentMapView) return;
    switch (viewType) {
        case 'top': currentMapView.Camera?.set({ tilt: 0, rotation: 0 }); break;
        case 'angle': currentMapView.Camera?.set({ tilt: 45, rotation: 0 }); break;
        case 'side': currentMapView.Camera?.set({ tilt: 75, rotation: 0 }); break;
        case 'rotate': 
          const currentRotation = currentMapView.Camera?.rotation || 0;
          currentMapView.Camera?.set({ rotation: currentRotation + 90 });
        break;
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify({ mapId, cameras }, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'camera-placements.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const imported = json.cameras || [];
        // Ensure imported cameras have new fields with defaults
        const normalized = imported.map((cam: any) => ({
          ...cam,
          model: cam.model || 'UC2W',
          powerSource: cam.powerSource || 'poe-upa1',
          internalTilt: cam.internalTilt ?? (cam.model === 'UC2N' ? -15 : -22),
          verticalFOV: cam.verticalFOV ?? (cam.model === 'UC2N' ? 35 : 44),
          room: cam.room || undefined,
        }));
        setCameras(normalized);
        setSelectedCamera(null);
      } catch (err) {
        alert('Invalid camera placements file');
      }
    };
    reader.readAsText(file);
  };

  if (isLoading) return <div className="flex items-center justify-center h-screen"><div className="text-xl">Loading map...</div></div>;
  if (error) return <div className="flex items-center justify-center h-screen"><div className="text-xl text-red-600">Error: {error.message}</div></div>;

  const selectedCameraData = cameras.find(c => c.id === selectedCamera);

  return (
    <div className="flex h-screen">
       <div 
         className="flex-1 relative"
         onMouseDownCapture={handleMouseDownCapture} 
         onMouseMoveCapture={handleMouseMove}
         onMouseUpCapture={handleMouseUp}
         style={{ cursor: placementMode ? 'crosshair' : cursorStyle }}
       >
          {mapData && (
             <MappedInMapView mapData={mapData} style={{ width: '100%', height: '100%' }}>
                <MapContent 
                  cameras={cameras} 
                  selectedCamera={selectedCamera}
                  onMapViewReady={setCurrentMapView}
                  mapData={mapData}
                  dragGhost={dragGhost}
                  placementMode={placementMode}
                  onPlaceCamera={handlePlaceCamera}
                  onHoverCoord={handleHoverCoord}
                />
             </MappedInMapView>
          )}

          {/* CONTROLS */}
          <div 
            className="absolute top-4 left-4 bg-white rounded-lg shadow-lg p-4 space-y-2 z-10 max-w-xs"
            onMouseDown={e => e.stopPropagation()} 
            onClick={e => e.stopPropagation()}
          >
             {/* Camera Model */}
             <div className="space-y-1">
               <label className="block text-xs font-medium text-gray-700">Camera Model</label>
               <select value={selectedModel} onChange={e => setSelectedModel(e.target.value as 'UC2W' | 'UC2N')} className="w-full px-3 py-2 text-sm border rounded">
                  {Object.entries(models).map(([id, m]) => (
                    <option key={id} value={id}>{m.name} ({m.defaultFOV}° FOV)</option>
                  ))}
               </select>
             </div>

             {/* Mount Type */}
             <div className="space-y-1">
               <label className="block text-xs font-medium text-gray-700">Mount Type</label>
               <select value={selectedMount || ''} onChange={e => setSelectedMount(e.target.value)} className="w-full px-3 py-2 text-sm border rounded">
                  {mounts.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
               </select>
             </div>

             {/* Power Source */}
             <div className="space-y-1">
               <label className="block text-xs font-medium text-gray-700">Power Source</label>
               <select value={selectedPowerSource} onChange={e => setSelectedPowerSource(e.target.value)} className="w-full px-3 py-2 text-sm border rounded">
                  {powerSources.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
               </select>
             </div>

             <button onClick={() => setPlacementMode(!placementMode)} disabled={!selectedMount} className={`w-full px-4 py-2 rounded font-medium ${placementMode ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
               {placementMode ? '✓ Click Map to Place' : 'Place Camera'}
             </button>

             <div className="flex gap-2">
               <button onClick={handleExport} disabled={cameras.length === 0} className="flex-1 px-4 py-2 bg-green-600 text-white rounded font-medium disabled:bg-gray-300 text-sm">Export</button>
               <label className="flex-1 px-4 py-2 bg-gray-600 text-white rounded font-medium text-sm text-center cursor-pointer hover:bg-gray-700">
                 Import
                 <input type="file" accept=".json" onChange={handleImport} className="hidden" />
               </label>
             </div>
          </div>
          
          {/* VIEW CONTROLS */}
          <div className="absolute top-4 right-1/2 transform translate-x-1/2 bg-white rounded-lg shadow-lg p-3 z-10" onMouseDown={e => e.stopPropagation()}>
            <div className="flex gap-2">
              <button onClick={() => handleCameraView('top')} className="px-3 py-2 text-xs bg-gray-200 rounded">⬇️ Top</button>
              <button onClick={() => handleCameraView('angle')} className="px-3 py-2 text-xs bg-gray-200 rounded">📐 45°</button>
              <button onClick={() => handleCameraView('side')} className="px-3 py-2 text-xs bg-gray-200 rounded">↔️ Side</button>
              <button onClick={() => handleCameraView('rotate')} className="px-3 py-2 text-xs bg-gray-200 rounded">🔄 Rotate</button>
            </div>
          </div>

          {/* STATUS BAR */}
          <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg px-4 py-2 z-10 text-xs text-gray-500">
            {cameras.length} cameras · Map: {mapId.slice(0, 8)}…
          </div>
          
          {placementMode && <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-10 animate-pulse pointer-events-none">👆 Click to place a NEW camera</div>}
          {!placementMode && cameras.length > 0 && <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg z-10 opacity-80 pointer-events-none">👆 Drag cameras to slide them along the wall</div>}
       </div>

       {/* SIDEBAR */}
       <div className="w-80 bg-gray-50 border-l border-gray-200 overflow-y-auto">
         <div className="p-4">
           <h2 className="text-xl font-bold mb-4">Cameras ({cameras.length})</h2>
           <div className="space-y-2">
             {cameras.map(c => (
               <div key={c.id} onClick={() => setSelectedCamera(c.id)} className={`p-3 rounded-lg cursor-pointer ${c.id === selectedCamera ? 'bg-blue-100 border-2 border-blue-500' : 'bg-white border border-gray-200'}`}>
                 <div className="font-medium text-sm">📹 {c.name}</div>
                 <div className="text-xs text-gray-500 mt-1">
                   {c.model} · {mounts.find(m => m.id === c.mountType)?.name || c.mountType}
                   {c.room && <span className="ml-1">· {c.room}</span>}
                 </div>
               </div>
             ))}
           </div>
           {selectedCameraData && (
             <div className="mt-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                <h3 className="font-bold mb-3 text-lg">Edit Camera</h3>
                <div className="space-y-4">
                   <div>
                     <label className="block text-sm font-medium">Name</label>
                     <input type="text" value={selectedCameraData.name} onChange={e => handleUpdateCamera(selectedCameraData.id, { name: e.target.value })} className="w-full border rounded px-2 py-1" />
                   </div>

                   {/* Model */}
                   <div>
                     <label className="block text-sm font-medium">Model</label>
                     <select value={selectedCameraData.model} onChange={e => handleUpdateCamera(selectedCameraData.id, { model: e.target.value as 'UC2W' | 'UC2N' })} className="w-full border rounded px-2 py-1">
                       {Object.entries(models).map(([id, m]) => (
                         <option key={id} value={id}>{m.name}</option>
                       ))}
                     </select>
                   </div>

                   {/* Mount Type */}
                   <div>
                     <label className="block text-sm font-medium">Mount Type</label>
                     <select value={selectedCameraData.mountType} onChange={e => handleUpdateCamera(selectedCameraData.id, { mountType: e.target.value })} className="w-full border rounded px-2 py-1">
                       {mounts.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                     </select>
                   </div>

                   {/* Power Source */}
                   <div>
                     <label className="block text-sm font-medium">Power Source</label>
                     <select value={selectedCameraData.powerSource} onChange={e => handleUpdateCamera(selectedCameraData.id, { powerSource: e.target.value })} className="w-full border rounded px-2 py-1">
                       {powerSources.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                     </select>
                   </div>

                   {/* Room (read-only, auto-detected) */}
                   {selectedCameraData.room && (
                     <div>
                       <label className="block text-sm font-medium">Room</label>
                       <div className="text-sm text-gray-600 px-2 py-1 bg-gray-50 rounded">{selectedCameraData.room}</div>
                     </div>
                   )}

                   {(() => {
                     const mount = mounts.find(m => m.id === selectedCameraData.mountType);
                     const locked = mount?.locked || {};
                     const isLocked = (param: string) => !!(locked as any)[param];

                     return (<>
                       {/* Height */}
                       <div>
                         <label className="block text-sm font-medium">
                           Height ({selectedCameraData.height.toFixed(1)}m)
                           {isLocked('height') && <span className="ml-1 text-xs text-gray-400">🔒 {mount?.useCeilingHeight ? 'ceiling' : 'locked'}</span>}
                         </label>
                         <input type="range" min="0.5" max="10" step="0.1" value={selectedCameraData.height}
                           onChange={e => handleUpdateCamera(selectedCameraData.id, { height: parseFloat(e.target.value) })}
                           disabled={isLocked('height')}
                           className={`w-full ${isLocked('height') ? 'opacity-40' : ''}`} />
                       </div>

                       {/* Tilt */}
                       <div>
                         <label className="block text-sm font-medium">
                           Tilt — mount: {selectedCameraData.tilt}° · effective: {selectedCameraData.tilt + selectedCameraData.internalTilt}°
                           {isLocked('tilt') && <span className="ml-1 text-xs text-gray-400">🔒</span>}
                         </label>
                         <input type="range" min="-90" max="30" value={selectedCameraData.tilt}
                           onChange={e => handleUpdateCamera(selectedCameraData.id, { tilt: parseInt(e.target.value) })}
                           disabled={isLocked('tilt')}
                           className={`w-full ${isLocked('tilt') ? 'opacity-40' : ''}`} />
                       </div>

                       {/* FOV (fixed by model, display only) */}
                       <div>
                         <label className="block text-sm font-medium">FOV</label>
                         <div className="text-sm text-gray-600 px-2 py-1 bg-gray-50 rounded">{selectedCameraData.fieldOfView}° H · {selectedCameraData.verticalFOV}° V</div>
                       </div>

                       {/* Range */}
                       <div>
                         <label className="block text-sm font-medium">
                           Range ({selectedCameraData.range}m)
                           {isLocked('range') && <span className="ml-1 text-xs text-gray-400">🔒</span>}
                         </label>
                         <input type="range" min="5" max="50" value={selectedCameraData.range}
                           onChange={e => handleUpdateCamera(selectedCameraData.id, { range: parseInt(e.target.value) })}
                           disabled={isLocked('range')}
                           className={`w-full ${isLocked('range') ? 'opacity-40' : ''}`} />
                       </div>

                       {/* Rotation */}
                       <div>
                         <label className="block text-sm font-medium">
                           Rotation ({selectedCameraData.rotation}°)
                           {isLocked('rotation') && <span className="ml-1 text-xs text-gray-400">🔒</span>}
                         </label>
                         <input type="range" min="0" max="360" value={selectedCameraData.rotation}
                           onChange={e => handleUpdateCamera(selectedCameraData.id, { rotation: parseInt(e.target.value) })}
                           disabled={isLocked('rotation')}
                           className={`w-full ${isLocked('rotation') ? 'opacity-40' : ''}`} />
                       </div>
                     </>);
                   })()}
                   <button onClick={handleDeleteCamera} className="w-full px-4 py-2 bg-red-600 text-white rounded">Delete</button>
                </div>
             </div>
           )}
         </div>
       </div>
    </div>
  );
}
