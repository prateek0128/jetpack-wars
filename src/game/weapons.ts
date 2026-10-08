import { Vector3 } from 'three';
export type WeaponId = 'VX9' | 'SH8';
export const WEAPONS = {
  VX9: { name: 'VX-9', type: 'LIGHT PISTOL', magazine: 12, interval: 280, reload: 1100, range: 42, damage: 25, automatic: true, pellets: 1 },
  SH8: { name: 'SH-8', type: 'SCATTERGUN', magazine: 6, interval: 850, reload: 1600, range: 16, damage: 8, automatic: false, pellets: 8 },
} as const;
// Fixed angular pattern, shared with the server; 9° total cone width.
export const PELLET_OFFSETS = [[0,0],[0.35,0],[-0.35,0],[0,0.35],[0,-0.35],[0.707,0.707],[-0.707,0.707],[0,-1]] as const;
export function pelletDirections(weapon: WeaponId, aim: Vector3): Vector3[] {
  if (weapon === 'VX9') return [aim.clone()];
  const right = new Vector3(aim.z, 0, -aim.x).normalize();
  if (right.lengthSq() < 0.01) right.set(1,0,0);
  const up = new Vector3().crossVectors(right, aim).normalize();
  const spread = Math.tan(4.5 * Math.PI / 180);
  return PELLET_OFFSETS.map(([x,y]) => aim.clone().addScaledVector(right,x*spread).addScaledVector(up,y*spread).normalize());
}
export type WeaponState = { selected_weapon: WeaponId; vx9_ammo: number; sh8_ammo: number; reload_weapon: WeaponId | null; reload_ends_at: string | null; weapon_updated_at: string };
