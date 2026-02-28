import { Camera } from '@/types/camera';

// --- Types ---

interface Point {
  x: number; // Longitude
  y: number; // Latitude
}

interface Segment {
  p1: Point;
  p2: Point;
}

// --- Constants ---
// Assumed Vertical Field of View (Total). 
const VERTICAL_FOV_DEG = 60;
const VERTICAL_HALF_ANGLE = (VERTICAL_FOV_DEG / 2) * (Math.PI / 180);

/**
 * Extract wall segments from MapData
 */
function getWallSegments(mapData: any): Segment[] {
  if (!mapData) return [];
  const segments: Segment[] = [];

  try {
    const spaces = mapData.getByType ? mapData.getByType('space') : [];
    
    if (spaces) {
      spaces.forEach((space: any) => {
        const geoJSON = space.geoJSON;
        if (!geoJSON || !geoJSON.geometry || !geoJSON.geometry.coordinates) return;

        const polygons = geoJSON.geometry.type === 'MultiPolygon'
          ? geoJSON.geometry.coordinates
          : [geoJSON.geometry.coordinates];

        polygons.forEach((ring: any[]) => {
          const coords = ring[0]; 
          if (!coords) return;

          for (let i = 0; i < coords.length - 1; i++) {
            segments.push({
              p1: { x: coords[i][0], y: coords[i][1] },
              p2: { x: coords[i+1][0], y: coords[i+1][1] }
            });
          }
        });
      });
    }
  } catch (e) {
    console.warn('Error extracting wall segments:', e);
  }

  return segments;
}

/**
 * Calculate the Viewing Cone as a Horizontal Frustum Sliced by Height Layers
 * Returns layers in DESCENDING order (Camera -> Floor) to fix thickness rendering.
 */
export function calculateViewingCone3D(
  camera: Camera,
  numLayers: number = 20, 
  mapData?: any
): Array<{
  height: number;
  vertices: Array<{ latitude: number; longitude: number }>;
}> {
  // 1. Setup
  const walls = mapData ? getWallSegments(mapData) : [];
  const origin: Point = { x: camera.longitude, y: camera.latitude };
  
  // 2. Pre-calculate Rays (Outer Boundary)
  const halfFOV = camera.fieldOfView / 2;
  const camRotation = (typeof camera.rotation === 'number' && !isNaN(camera.rotation)) ? camera.rotation : 0;
  const startAngle = camRotation - halfFOV;
  const endAngle = camRotation + halfFOV;
  const step = 1.0; 

  const rays: Array<{ angle: number; maxDist: number }> = [];

  for (let angleDeg = startAngle; angleDeg <= endAngle; angleDeg += step) {
    // Calculate theoretical max range point
    const maxPointGeo = destinationPoint(camera.latitude, camera.longitude, camera.range, angleDeg);
    const maxPoint: Point = { x: maxPointGeo.longitude, y: maxPointGeo.latitude };
    
    const raySegment: Segment = { p1: origin, p2: maxPoint };
    
    // Check wall intersections to find Outer Limit
    let closestDist = camera.range; 
    
    for (const wall of walls) {
       const t = getLineIntersection(raySegment, wall);
       if (t !== null && t > 0.001) {
         const hitDist = t * camera.range;
         if (hitDist < closestDist) {
           closestDist = hitDist;
         }
       }
    }
    rays.push({ angle: angleDeg, maxDist: closestDist });
  }

  // 3. Generate 3D Layers
  const layers: Array<{ height: number; vertices: Array<{ latitude: number; longitude: number }> }> = [];

  // Loop Descending: Start from Camera Height (t=1), go down to Floor (t=0)
  for (let i = numLayers - 1; i >= 0; i--) {
    const t = i / (numLayers - 1); 
    const currentHeight = camera.height * t;
    
    // Calculate Inner Radius for this height
    // At Camera (deltaZ=0) -> d_min = 0 (Full View)
    // At Floor (deltaZ=H) -> d_min = Large (Blind Spot)
    const deltaZ = Math.abs(camera.height - currentHeight);
    const innerRadius = deltaZ / Math.tan(VERTICAL_HALF_ANGLE);

    const layerVertices: Point[] = [];

    // Part A: Outer Boundary (End -> Start, CCW)
    for (let r = rays.length - 1; r >= 0; r--) {
      const ray = rays[r];
      if (ray.maxDist > innerRadius) {
         const p = destinationPoint(camera.latitude, camera.longitude, ray.maxDist, ray.angle);
         layerVertices.push({ x: p.longitude, y: p.latitude });
      }
    }

    // Part B: Inner Boundary (Start -> End, CW)
    if (layerVertices.length > 0) {
        for (let r = 0; r < rays.length; r++) {
            const ray = rays[r];
            if (ray.maxDist > innerRadius) {
                const dist = Math.max(0.01, innerRadius);
                const p = destinationPoint(camera.latitude, camera.longitude, dist, ray.angle);
                layerVertices.push({ x: p.longitude, y: p.latitude });
            }
        }
        
        // Close polygon
        layerVertices.push(layerVertices[0]);
        
        layers.push({ 
            height: currentHeight, 
            vertices: layerVertices.map(v => ({ latitude: v.y, longitude: v.x })) 
        });
    }
  }

  return layers;
}

// --- Helper Math Functions ---

function getLineIntersection(seg1: Segment, seg2: Segment): number | null {
  const x1 = seg1.p1.x, y1 = seg1.p1.y;
  const x2 = seg1.p2.x, y2 = seg1.p2.y;
  const x3 = seg2.p1.x, y3 = seg2.p1.y;
  const x4 = seg2.p2.x, y4 = seg2.p2.y;

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) return null;

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return ua;
  }
  return null;
}

function destinationPoint(lat: number, lng: number, distance: number, bearing: number) {
  const R = 6371000; 
  const δ = distance / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const θ = (bearing * Math.PI) / 180;
  
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  
  return { latitude: (φ2 * 180) / Math.PI, longitude: (λ2 * 180) / Math.PI };
}

export function generateCameraId(): string {
  return `camera_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function calculateAngle(centerLat: number, centerLng: number, pointLat: number, pointLng: number): number {
  const dLng = pointLng - centerLng;
  const dLat = pointLat - centerLat;
  let angle = Math.atan2(dLng, dLat) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

export function calculateViewingCone(camera: Camera): Array<{ latitude: number; longitude: number }> {
  // Return the Top Layer (Full Wedge) for 2D footprint requests
  const layers = calculateViewingCone3D(camera, 2);
  // With descending order, the top layer is now index 0
  return layers[0]?.vertices || [];
}

// ... (Keep imports and calculateViewingCone3D unchanged) ...

/**
 * Finds the closest wall to snap to
 * UPDATED: 
 * 1. Latitude Correction & Grid Snapping (from previous step).
 * 2. WALL OFFSET: Pushes the camera 0.2m (20cm) off the wall centerline 
 * so it appears attached to the surface, not inside it.
 */
export function findClosestWall(
  lat: number,
  lng: number,
  walls: Array<{ coords: Array<[number, number]>, height: number }>
): { 
  closestPoint: [number, number];
  distance: number;
  rotation: number;
  inwardRotation: number;
} | null {
  let minDistance = Infinity;
  let bestResult = null;
  
  // Settings
  const SNAP_INCREMENT = 15; // Snap angles to nearest 15 degrees
  const SNAP_THRESHOLD = 10; // Aggressive snapping window
  const WALL_OFFSET_METERS = 0.2; // Push camera 20cm out from wall center
  const METERS_PER_DEG = 111132; // Approx meters per degree latitude

  // Latitude Correction Factor
  const latRad = lat * Math.PI / 180;
  const scaleX = Math.cos(latRad);

  walls.forEach(wall => {
    for (let i = 0; i < wall.coords.length - 1; i++) {
      const p1 = { x: wall.coords[i][0], y: wall.coords[i][1] };
      const p2 = { x: wall.coords[i+1][0], y: wall.coords[i+1][1] };
      const p = { x: lng, y: lat }; 
      
      const { dist, closest } = pointToSegmentDistance(p, p1, p2);
      
      if (dist < minDistance) {
        minDistance = dist;
        const centroid = calculateCentroid(wall.coords);
        
        // 1. Calculate Real-World Geometric Angle
        const dy = p2.y - p1.y;
        const dx = (p2.x - p1.x) * scaleX;
        
        let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
        
        // 2. Grid Snapping
        let normalizedAngle = (angleDeg + 360) % 360;
        const nearestGrid = Math.round(normalizedAngle / SNAP_INCREMENT) * SNAP_INCREMENT;
        
        let diff = Math.abs(normalizedAngle - nearestGrid);
        if (diff > 180) diff = 360 - diff;

        if (diff <= SNAP_THRESHOLD) {
            angleDeg = nearestGrid; 
        }

        // 3. Convert back to Radians
        const wallAngleRad = angleDeg * Math.PI / 180;
        
        // 4. Calculate Normals
        const norm1 = wallAngleRad + Math.PI / 2;
        const norm2 = wallAngleRad - Math.PI / 2;
        
        // 5. Determine Inward Direction
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        
        const toCentroidX = (centroid[0] - midX) * scaleX;
        const toCentroidY = centroid[1] - midY;
        
        const n1x = Math.cos(norm1);
        const n1y = Math.sin(norm1);
        
        const dot = n1x * toCentroidX + n1y * toCentroidY;
        const bestAngleRad = dot > 0 ? norm1 : norm2;
        
        // --- NEW: Calculate Offset Position ---
        // We move the point along the 'bestAngleRad' (Inward Normal)
        const pushX = Math.cos(bestAngleRad); // Longitude component (scaled)
        const pushY = Math.sin(bestAngleRad); // Latitude component
        
        // Convert meters to degrees
        const offsetLat = (pushY * WALL_OFFSET_METERS) / METERS_PER_DEG;
        const offsetLng = (pushX * WALL_OFFSET_METERS) / (METERS_PER_DEG * scaleX);
        
        const finalX = closest.x + offsetLng;
        const finalY = closest.y + offsetLat;

        // 6. Convert to Bearing
        const mathDeg = (bestAngleRad * 180 / Math.PI);
        let bearing = 90 - mathDeg;
        bearing = (bearing + 360) % 360;
        
        if (isNaN(bearing)) bearing = 0;

        bestResult = {
          closestPoint: [finalX, finalY] as [number, number], // Return offset point
          distance: dist,
          rotation: bearing,
          inwardRotation: bearing
        };
      }
    }
  });
  
  return bestResult;
}

// ... (Keep pointToSegmentDistance and calculateCentroid unchanged) ...
function pointToSegmentDistance(p: Point, v: Point, w: Point) {
  const l2 = (w.x - v.x)**2 + (w.y - v.y)**2;
  if (l2 === 0) return { dist: Math.hypot(p.x - v.x, p.y - v.y), closest: v };
  
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  
  const closest = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return { dist: Math.hypot(p.x - closest.x, p.y - closest.y), closest };
}

function calculateCentroid(coords: Array<[number, number]>): [number, number] {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i < coords.length; i++) {
    sumX += coords[i][0];
    sumY += coords[i][1];
    count++;
  }
  return count > 0 ? [sumX / count, sumY / count] : [0, 0];
}