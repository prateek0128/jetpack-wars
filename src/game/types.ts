import type { MutableRefObject } from 'react';
import type { Vector3 } from 'three';
import type { WeaponId, WeaponState } from './weapons';

export type TargetState = {
  id: number;
  position: [number, number, number];
  health: number;
  alive: boolean;
  destroyedAt: number;
  respawnAt: number;
  lastHitAt: number;
};

export type GameSnapshot = {
  hp: number;
  fuel: number;
  ammo: number;
  weapon: WeaponId;
  kills: number;
  deaths: number;
  timeLeft: number;
  reloading: boolean;
  reloadProgress: number;
  hitFlash: number;
  respawnRemaining: number;
  deathAt: number;
  hitAt: number;
  playerPosition: [number, number, number];
  targetStates: TargetState[];
};

export type PlayerMotion = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  grounded: boolean;
  jetpackActive: boolean;
};

export type GameApi = {
  snapshot: GameSnapshot;
  weaponRef: MutableRefObject<WeaponId>;
  switchWeapon: (weapon: WeaponId) => void;
  applyWeaponState: (state: WeaponState) => void;
  playerRef: MutableRefObject<Vector3>;
  velocityRef: MutableRefObject<Vector3>;
  groundedRef: MutableRefObject<boolean>;
  yawRef: MutableRefObject<number>;
  pitchRef: MutableRefObject<number>;
  fuelRef: MutableRefObject<number>;
  lastShotAtRef: MutableRefObject<number>;
  aimDirectionRef: MutableRefObject<Vector3>;
  motionRef: MutableRefObject<PlayerMotion>;
  setSpawn: (position: [number, number, number], yaw: number) => void;
  fire: (origin: Vector3, direction: Vector3) => boolean;
  reload: () => void;
  damage: (amount: number) => void;
  hitTarget: (id: number, damage?: number) => void;
  consumeFuel: (amount: number) => void;
  restoreFuel: (amount: number) => void;
  resetPlayer: () => void;
  applyAuthoritativeCombat: (state: { hp: number; kills: number; deaths: number; alive: boolean; deadUntil: string | null; tookDamage?: boolean }) => void;
  confirmHit: () => void;
};
