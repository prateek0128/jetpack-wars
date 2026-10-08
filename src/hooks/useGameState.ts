import { localFeedback } from '../presentation/events';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { MAGAZINE_SIZE, MATCH_SECONDS, PLAYER_MAX_FUEL, PLAYER_MAX_HP, TARGET_POSITIONS } from '../game/constants';
import { WEAPONS, type WeaponId, type WeaponState } from '../game/weapons';
import { SPAWNS } from '../game/arenaLayout';
import type { GameApi, GameSnapshot, PlayerMotion, TargetState } from '../game/types';

const initialTargets = (): TargetState[] => TARGET_POSITIONS.map((position, id) => ({
  id, position, health: 100, alive: true, destroyedAt: 0, respawnAt: 0, lastHitAt: 0,
}));

export function useGameState(): GameApi {
  const playerRef = useRef(new Vector3(...SPAWNS[0]));
  const velocityRef = useRef(new Vector3());
  const groundedRef = useRef(false);
  const yawRef = useRef(Math.atan2(SPAWNS[0][0], SPAWNS[0][2]) + 0.145);
  const pitchRef = useRef(-0.06);
  const fuelRef = useRef(PLAYER_MAX_FUEL);
  const hpRef = useRef(PLAYER_MAX_HP);
  const ammoRef = useRef(MAGAZINE_SIZE);
  const weaponRef = useRef<WeaponId>('VX9');
  const magazines = useRef({ VX9: 12, SH8: 6 });
  const reloadTimer = useRef<number>();
  const weaponRevision = useRef(0);
  const reloadRef = useRef(false);
  const reloadEndsAt = useRef<number | null>(null);
  const targetsRef = useRef(initialTargets());
  const matchRef = useRef(MATCH_SECONDS);
  const respawnRef = useRef(0);
  const deathAtRef = useRef(0);
  const invulnerableRef = useRef(0);
  const authoritativeRef = useRef(false);
  const lastShotAtRef = useRef(0);
  const aimDirectionRef = useRef(new Vector3(0, 0, -1));
  const motionRef = useRef<PlayerMotion>({ x: SPAWNS[0][0], y: SPAWNS[0][1], z: SPAWNS[0][2], yaw: Math.atan2(SPAWNS[0][0], SPAWNS[0][2]) + 0.145, velocityX: 0, velocityY: 0, velocityZ: 0, grounded: false, jetpackActive: false });
  const counters = useRef({ kills: 0, deaths: 0, hitFlash: 0, hitAt: 0 });
  const [snapshot, setSnapshot] = useState<GameSnapshot>({
    hp: PLAYER_MAX_HP, fuel: PLAYER_MAX_FUEL, ammo: MAGAZINE_SIZE, weapon: 'VX9', kills: 0, deaths: 0,
    timeLeft: MATCH_SECONDS, reloading: false, reloadProgress: 0, hitFlash: 0, respawnRemaining: 0, deathAt: 0, hitAt: 0,
    playerPosition: [...SPAWNS[0]], targetStates: initialTargets(),
  });

  const cancelReload = useCallback(() => { window.clearTimeout(reloadTimer.current); reloadRef.current = false; reloadEndsAt.current = null; }, []);
  const switchWeapon = useCallback((weapon: WeaponId) => {
    if (hpRef.current <= 0 || weaponRef.current === weapon) return;
    cancelReload();
    magazines.current[weaponRef.current] = ammoRef.current;
    weaponRef.current = weapon;
    ammoRef.current = magazines.current[weapon];
  }, [cancelReload]);
  const applyWeaponState = useCallback((state: WeaponState) => {
    const revision = Date.parse(state.weapon_updated_at);
    if (!Number.isFinite(revision) || revision < weaponRevision.current) return;
    weaponRevision.current = revision;
    cancelReload();
    weaponRef.current = state.selected_weapon;
    magazines.current = { VX9: state.vx9_ammo, SH8: state.sh8_ammo };
    ammoRef.current = magazines.current[state.selected_weapon];
    reloadRef.current = state.reload_weapon === state.selected_weapon;
    reloadEndsAt.current = state.reload_ends_at ? Date.parse(state.reload_ends_at) : null;
  }, [cancelReload]);
  const startReload = useCallback(() => {
    const weapon = weaponRef.current;
    if (authoritativeRef.current || hpRef.current <= 0 || reloadRef.current || ammoRef.current === WEAPONS[weapon].magazine) return;
    reloadRef.current = true;
    reloadEndsAt.current = Date.now()+WEAPONS[weapon].reload;
    reloadTimer.current = window.setTimeout(() => {
      magazines.current[weapon] = WEAPONS[weapon].magazine;
      ammoRef.current = magazines.current[weapon]; reloadRef.current = false; reloadEndsAt.current = null;
    }, WEAPONS[weapon].reload);
  }, []);
  const resetWeapons = useCallback(() => {
    cancelReload(); weaponRef.current = 'VX9'; magazines.current = { VX9: 12, SH8: 6 }; ammoRef.current = 12;
  }, [cancelReload]);
  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);

  const resetPlayer = useCallback(() => {
    const spawn = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
    playerRef.current.set(...spawn);
    velocityRef.current.set(0, 0, 0);
    groundedRef.current = false;
    yawRef.current = Math.atan2(spawn[0], spawn[2]) + 0.145;
    hpRef.current = PLAYER_MAX_HP;
    fuelRef.current = PLAYER_MAX_FUEL;
    resetWeapons();
    reloadRef.current = false;
    pitchRef.current = -0.06;
    invulnerableRef.current = 1.35;
    respawnRef.current = 0;
  }, [resetWeapons]);

  const setSpawn = useCallback((position: [number, number, number], yaw: number) => {
    playerRef.current.set(...position);
    velocityRef.current.set(0, 0, 0);
    groundedRef.current = false;
    yawRef.current = yaw;
    pitchRef.current = -0.06;
    hpRef.current = PLAYER_MAX_HP;
    fuelRef.current = PLAYER_MAX_FUEL;
    resetWeapons();
    motionRef.current.x = position[0]; motionRef.current.y = position[1]; motionRef.current.z = position[2];
    motionRef.current.yaw = yaw; motionRef.current.velocityX = 0; motionRef.current.velocityY = 0; motionRef.current.velocityZ = 0;
    motionRef.current.grounded = false; motionRef.current.jetpackActive = false;
    respawnRef.current = 0;
  }, [resetWeapons]);

  const applyAuthoritativeCombat = useCallback((state: { hp: number; kills: number; deaths: number; alive: boolean; deadUntil: string | null; tookDamage?: boolean }) => {
    authoritativeRef.current = true;
    const wasAlive = hpRef.current > 0;
    hpRef.current = Math.max(0, Math.min(100, state.hp));
    counters.current.kills = state.kills;
    counters.current.deaths = state.deaths;
    if (state.tookDamage) counters.current.hitFlash = 0.28;
    if (state.alive) {
      respawnRef.current = 0;
      invulnerableRef.current = 0;
      deathAtRef.current = 0;
    } else {
      respawnRef.current = state.deadUntil ? Math.max(0, (Date.parse(state.deadUntil) - Date.now()) / 1000) : 0;
      if (wasAlive) deathAtRef.current = performance.now();
    }
  }, []);

  const confirmHit = useCallback(() => { counters.current.hitAt = performance.now(); }, []);

  const damage = useCallback((amount: number) => {
    if (authoritativeRef.current) return;
    if (invulnerableRef.current > 0 || respawnRef.current > 0) return;
    const current = Math.max(0, hpRef.current - amount);
    hpRef.current = current;
    counters.current.hitFlash = 0.28;
    if (current === 0) {
      counters.current.deaths += 1;
      respawnRef.current = 2.8;
      deathAtRef.current = performance.now();
    }
  }, []);

  const hitTarget = useCallback((id: number, damage = 25) => {
    if (authoritativeRef.current) return;
    const target = targetsRef.current.find((candidate) => candidate.id === id);
    if (!target?.alive) return;
    target.health -= damage;
    target.lastHitAt = performance.now();
    counters.current.hitAt = target.lastHitAt;
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      target.destroyedAt = target.lastHitAt;
      target.respawnAt = target.lastHitAt + 3600;
      counters.current.kills += 1;
    }
  }, []);

  const fire = useCallback((_origin: Vector3, _direction: Vector3) => {
    if (reloadRef.current || respawnRef.current > 0 || hpRef.current <= 0) return false;
    if (ammoRef.current <= 0) { startReload(); return false; }
    ammoRef.current -= 1;
    magazines.current[weaponRef.current] = ammoRef.current;
    lastShotAtRef.current = performance.now();
    localFeedback({ type: 'shot', weapon: weaponRef.current });
    if (ammoRef.current === 0) startReload();
    return true;
  }, [startReload]);
  const consumeFuel = useCallback((amount: number) => { fuelRef.current = Math.max(0, fuelRef.current - amount); }, []);
  const restoreFuel = useCallback((amount: number) => { fuelRef.current = Math.min(PLAYER_MAX_FUEL, fuelRef.current + amount); }, []);

  useEffect(() => {
    let last = performance.now();
    let accumulated = 0;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      accumulated += dt;
      matchRef.current = Math.max(0, matchRef.current - dt);
      if (respawnRef.current > 0) {
        respawnRef.current = Math.max(0, respawnRef.current - dt);
        if (respawnRef.current === 0 && !authoritativeRef.current) resetPlayer();
      }
      invulnerableRef.current = Math.max(0, invulnerableRef.current - dt);
      counters.current.hitFlash = Math.max(0, counters.current.hitFlash - dt);
      targetsRef.current.forEach((target) => {
        if (!target.alive && now >= target.respawnAt) {
          target.alive = true;
          target.health = 100;
          target.destroyedAt = 0;
        }
      });
      if (accumulated >= 0.08) {
        accumulated = 0;
        setSnapshot({
          hp: hpRef.current, fuel: fuelRef.current, ammo: ammoRef.current, weapon: weaponRef.current,
          kills: counters.current.kills, deaths: counters.current.deaths, timeLeft: matchRef.current,
          reloading: reloadRef.current, reloadProgress: reloadRef.current && reloadEndsAt.current ? Math.max(0,Math.min(0.95,1-(reloadEndsAt.current-Date.now())/WEAPONS[weaponRef.current].reload)) : 0, hitFlash: counters.current.hitFlash,
          respawnRemaining: respawnRef.current, deathAt: deathAtRef.current, hitAt: counters.current.hitAt,
          playerPosition: [playerRef.current.x, playerRef.current.y, playerRef.current.z],
          targetStates: targetsRef.current.map((target) => ({ ...target })),
        });
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [resetPlayer]);

  return { snapshot, weaponRef, switchWeapon, applyWeaponState, playerRef, velocityRef, groundedRef, yawRef, pitchRef, fuelRef, lastShotAtRef, aimDirectionRef, motionRef, setSpawn, fire, reload: startReload, damage, hitTarget, consumeFuel, restoreFuel, resetPlayer, applyAuthoritativeCombat, confirmHit };
}
