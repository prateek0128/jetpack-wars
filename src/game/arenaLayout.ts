export type ArenaBox = {
  id: string;
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  accent?: string;
  solid?: boolean;
};

// These boxes are used by both the renderer and lightweight player collision.
export const ARENA_BOXES: ArenaBox[] = [
  { id: 'floor', position: [0, -0.4, 0], size: [40, 0.8, 40], color: '#162532' },
  { id: 'north-wall', position: [0, 3, -20.4], size: [40.8, 6, 0.8], color: '#233947', accent: '#157b84' },
  { id: 'south-wall', position: [0, 3, 20.4], size: [40.8, 6, 0.8], color: '#233947', accent: '#157b84' },
  { id: 'west-wall', position: [-20.4, 3, 0], size: [0.8, 6, 40], color: '#233947', accent: '#157b84' },
  { id: 'east-wall', position: [20.4, 3, 0], size: [0.8, 6, 40], color: '#233947', accent: '#157b84' },
  // A three metre side deck and a rear high deck frame the central firing lane.
  { id: 'west-deck', position: [-12, 2.68, 0], size: [6.4, 0.6, 7.4], color: '#315061', accent: '#26aaa8' },
  { id: 'east-deck', position: [12, 2.68, 0], size: [6.4, 0.6, 7.4], color: '#315061', accent: '#26aaa8' },
  { id: 'high-deck', position: [0, 4.28, -13], size: [10, 0.64, 5.6], color: '#385665', accent: '#26aaa8' },
  { id: 'south-bridge', position: [0, 2.15, 13], size: [9, 0.55, 4], color: '#2b4859', accent: '#247e86' },
  { id: 'cover-west-deck', position: [-14.2, 3.58, -1.6], size: [1, 1.2, 2.8], color: '#405363' },
  { id: 'cover-east-deck', position: [14.2, 3.58, 1.6], size: [1, 1.2, 2.8], color: '#405363' },
  { id: 'cover-upper', position: [0, 5.2, -14.9], size: [3.2, 1.2, 0.7], color: '#405363' },
  { id: 'cover-bridge', position: [2.8, 3.025, 13.6], size: [0.8, 1.2, 2], color: '#405363' },
  { id: 'cover-center-west', position: [-3.8, 1.25, 0], size: [0.8, 2.5, 2.8], color: '#344958' },
  { id: 'cover-center-east', position: [3.8, 1.25, 0], size: [0.8, 2.5, 2.8], color: '#344958' },
  // Low cover and short dividers keep the central area readable and traversable.
  { id: 'cover-west', position: [-6.8, 0.8, -4.5], size: [2.6, 1.6, 2.2], color: '#405363' },
  { id: 'cover-east', position: [6.8, 0.8, 4.5], size: [2.6, 1.6, 2.2], color: '#405363' },
  { id: 'cover-north-west', position: [-7.4, 1.15, -12], size: [3.8, 2.3, 1.1], color: '#465b69' },
  { id: 'cover-north-east', position: [7.4, 1.15, -12], size: [3.8, 2.3, 1.1], color: '#465b69' },
  { id: 'cover-south-west', position: [-7.4, 0.8, 12], size: [3.8, 1.6, 1.1], color: '#465b69' },
  { id: 'cover-south-east', position: [7.4, 0.8, 12], size: [3.8, 1.6, 1.1], color: '#465b69' },
  { id: 'pillar-west', position: [-17, 1.4, -7], size: [1.2, 2.8, 3.2], color: '#344958' },
  { id: 'pillar-east', position: [17, 1.4, 7], size: [1.2, 2.8, 3.2], color: '#344958' },
];

export type ArenaRamp = {
  id: string;
  position: [number, number, number];
  size: [number, number, number];
  rotationX: number;
  color: string;
};

// Define ramps by their top-face endpoints so render geometry and support agree.
function routeRamp(id: string, x: number, lowZ: number, highZ: number, height: number, width: number): ArenaRamp {
  const angle = Math.atan(-height / (highZ - lowZ));
  const thickness = 0.4;
  return { id, position: [x, height / 2 - thickness / 2 * Math.cos(angle),
    (lowZ + highZ) / 2 - thickness / 2 * Math.sin(angle)],
    size: [width, thickness, Math.hypot(highZ - lowZ, height)], rotationX: angle, color: '#365969' };
}
export const ARENA_RAMPS: ArenaRamp[] = [
  routeRamp('west-ramp', -12, 11.7, 3.7, 2.98, 4.2),
  routeRamp('east-ramp', 12, -11.7, -3.7, 2.98, 4.2),
  routeRamp('high-ramp', 0, -1.8, -10.2, 4.6, 4.2),
  routeRamp('south-ramp', 0, 19, 15, 2.425, 4.2),
];

export type Surface = { id: string; x: number; z: number; halfX: number; halfZ: number; height: number };
export const FLAT_SURFACES: Surface[] = [
  { id: 'floor', x: 0, z: 0, halfX: 20, halfZ: 20, height: 0 },
  { id: 'west-deck', x: -12, z: 0, halfX: 3.2, halfZ: 3.7, height: 2.98 },
  { id: 'east-deck', x: 12, z: 0, halfX: 3.2, halfZ: 3.7, height: 2.98 },
  { id: 'high-deck', x: 0, z: -13, halfX: 5, halfZ: 2.8, height: 4.6 },
  { id: 'south-bridge', x: 0, z: 13, halfX: 4.5, halfZ: 2, height: 2.425 },
  ...ARENA_BOXES.filter((box) => box.id.startsWith('cover-') || box.id.startsWith('pillar-')).map((box) => ({
    id: box.id,
    x: box.position[0], z: box.position[2], halfX: box.size[0] / 2, halfZ: box.size[2] / 2,
    height: box.position[1] + box.size[1] / 2,
  })),
];

export const SPAWNS: [number, number, number][] = [
  [-4, 0, 5], [4, 0, -5], [-4, 0, -5], [4, 0, 5],
  [-12, 2.98, 0], [12, 2.98, 0], [0, 4.6, -13], [0, 2.425, 13],
];

export function rampSurfaceAt(x: number, z: number): number | null {
  let highest: number | null = null;
  for (const ramp of ARENA_RAMPS) {
    const [cx, cy, cz] = ramp.position;
    const [width, , length] = ramp.size;
    const dx = x - cx;
    const dz = z - cz;
    const angle = ramp.rotationX;
    const halfThickness = ramp.size[1] / 2;
    // Inverse rotation to find the top face height at the player's horizontal position.
    const height = cy + (halfThickness - dz * Math.sin(angle)) / Math.cos(angle);
    const localZ = dz * Math.cos(angle) - (height - cy) * Math.sin(angle);
    if (Math.abs(dx) <= width / 2 && Math.abs(localZ) <= length / 2 + 0.1 && (highest === null || height > highest)) highest = height;
  }
  return highest;
}

export function intersectBox(origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, box: ArenaBox): number | null {

  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
    const d = axis === 0 ? direction.x : axis === 1 ? direction.y : direction.z;
    const min = box.position[axis] - box.size[axis] / 2;
    const max = box.position[axis] + box.size[axis] / 2;
    if (Math.abs(d) < 1e-6) {
      if (o < min || o > max) return null;
      continue;
    }
    let a = (min - o) / d;
    let b = (max - o) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  return far >= 0 ? Math.max(0, near) : null;
}

export function intersectRamp(origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, ramp: ArenaRamp): number | null {
  const [cx, cy, cz] = ramp.position;
  const angle = ramp.rotationX;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const ox = origin.x - cx;
  const oy = origin.y - cy;
  const oz = origin.z - cz;
  const localOrigin = { x: ox, y: oy * cosine + oz * sine, z: -oy * sine + oz * cosine };
  const localDirection = { x: direction.x, y: direction.y * cosine + direction.z * sine, z: -direction.y * sine + direction.z * cosine };
  const localBox: ArenaBox = { id: ramp.id, position: [0, 0, 0], size: ramp.size, color: ramp.color };
  return intersectBox(localOrigin, localDirection, localBox);
}
