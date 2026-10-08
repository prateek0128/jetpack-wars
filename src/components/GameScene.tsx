import PresentationEffects from './PresentationEffects';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Object3D, Raycaster, Vector2, Vector3 } from 'three';
import { ARENA_BOXES, ARENA_RAMPS, intersectBox, intersectRamp } from '../game/arenaLayout';
import { WEAPONS, pelletDirections, type WeaponId } from '../game/weapons';
import type { GameApi } from '../game/types';
import type { MutableRefObject } from 'react';
import type { CombatEvent, GameSession, MovementPacket } from '../multiplayer/types';
import Arena from './Arena';
import Effects, { type Shot } from './Effects';
import Player from './Player';
import RemotePlayers from './RemotePlayers';
import Targets from './Targets';

function Controls({ game, multiplayer, matchActive, fireAuthoritative, reloadAuthoritative }: { game: GameApi; multiplayer: boolean; matchActive: boolean; fireAuthoritative?: (weapon: WeaponId, direction: [number, number, number]) => void; reloadAuthoritative?: () => void }) {
  const { camera, gl, scene } = useThree();
  const shooting = useRef(false);
  const aiming = useRef(false);
  const lastPointer = useRef(new Vector2());
  const nextShotAt = useRef<Record<WeaponId, number>>({ VX9: 0, SH8: 0 });
  const [shots, setShots] = useState<Shot[]>([]);
  const raycaster = useRef(new Raycaster());
  const aimOrigin = useRef(new Vector3());
  const aimDirection = useRef(new Vector3());
  const playerRef = game.playerRef;
  const fire = game.fire;
  const hitTarget = game.hitTarget;


  const shoot = useCallback(() => {
    if (multiplayer && !matchActive) return;
    const now = performance.now();
    if (now < nextShotAt.current[game.weaponRef.current]) return;
    const origin = aimOrigin.current.copy(camera.position);
    const direction = camera.getWorldDirection(aimDirection.current).normalize();
    const weapon = game.weaponRef.current;
    const stats = WEAPONS[weapon];
    if (!fire(origin, direction)) {
      if (multiplayer && game.snapshot.ammo === 0 && !game.snapshot.reloading) reloadAuthoritative?.();
      return;
    }
    nextShotAt.current[weapon] = now + stats.interval;
    const tracers: Shot[] = [];
    for (const pellet of pelletDirections(weapon, direction)) {


    raycaster.current.set(origin, pellet);
    const roots: { id: number; object: Object3D }[] = [];
    scene.traverse((object) => { if (object.userData.targetId !== undefined) roots.push({ id: object.userData.targetId as number, object }); });
    let nearestTarget: { id: number; distance: number } | null = null;
    for (const target of roots) {
      const intersections = raycaster.current.intersectObject(target.object, true);
      const first = intersections[0];
      if (first && first.distance < stats.range && (!nearestTarget || first.distance < nearestTarget.distance)) nearestTarget = { id: target.id, distance: first.distance };
    }

    let nearestWall: number = stats.range;
    for (const box of ARENA_BOXES) {
      if (box.id === 'floor') continue;
      const distance = intersectBox(origin, pellet, box);
      if (distance !== null && distance > 0.05) nearestWall = Math.min(nearestWall, distance);
    }
    for (const ramp of ARENA_RAMPS) {
      const distance = intersectRamp(origin, pellet, ramp);
      if (distance !== null && distance > 0.05) nearestWall = Math.min(nearestWall, distance);
    }
    const hit = nearestTarget !== null && nearestTarget.distance <= nearestWall;
    const travel = hit ? nearestTarget!.distance : nearestWall;
    const end = origin.clone().addScaledVector(pellet, travel);
    const horizontalForward = new Vector3(-Math.sin(game.yawRef.current), 0, -Math.cos(game.yawRef.current));
    const right = new Vector3(Math.cos(game.yawRef.current), 0, -Math.sin(game.yawRef.current));
    const muzzle = playerRef.current.clone().add(new Vector3(0, 1.04, 0)).addScaledVector(horizontalForward, 0.64).addScaledVector(right, 0.38);
    const tracer = { id: performance.now() + Math.random(), from: muzzle, to: end, created: now, hit: !multiplayer && hit };
    tracers.push({ ...tracer, weapon });
    if (!multiplayer && hit && nearestTarget) hitTarget(nearestTarget.id, stats.damage);
    }
    setShots((current) => [...current.filter((shot) => now - shot.created < 180).slice(-24), ...tracers]);
    if (multiplayer) fireAuthoritative?.(weapon, [direction.x, direction.y, direction.z]);
  }, [camera, fire, reloadAuthoritative, game.weaponRef, game.snapshot.ammo, game.snapshot.reloading, game.yawRef, hitTarget, matchActive, multiplayer, playerRef, scene, fireAuthoritative]);

  useEffect(() => {
    const onRemoteShot = (event: Event) => {
      const shot = (event as CustomEvent<CombatEvent>).detail;
      if (!shot.origin || !shot.end) return;
      const tracer: Shot = { weapon: shot.weapon, id: performance.now() + Math.random(), from: new Vector3(...shot.origin), to: new Vector3(...shot.end), created: performance.now(), hit: Boolean(shot.hit) };
      const tracers = shot.pellets?.map((pellet, index) => ({ ...tracer, id: tracer.id + index, to: new Vector3(...pellet.end), hit: pellet.hit })) ?? [tracer];
      setShots((current) => [...current.filter((item) => performance.now() - item.created < 180).slice(-24), ...tracers]);
    };
    window.addEventListener('game-remote-shot', onRemoteShot);
    return () => window.removeEventListener('game-remote-shot', onRemoteShot);
  }, []);

  useEffect(() => {
    const canvas = gl.domElement;
    const down = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (document.pointerLockElement !== canvas) {
        try { canvas.requestPointerLock?.()?.catch(() => undefined); } catch { /* fallback mouse aiming remains available */ }
      }
      aiming.current = true;
      canvas.style.cursor = 'none';
      lastPointer.current.set(event.clientX, event.clientY);
      window.dispatchEvent(new CustomEvent('game-aim-state', { detail: { active: true } }));
      shooting.current = WEAPONS[game.weaponRef.current].automatic;
      shoot();
    };
    const up = () => { shooting.current = false; };
    const move = (event: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        game.yawRef.current -= event.movementX * 0.002;
        game.pitchRef.current = Math.max(-0.68, Math.min(0.6, game.pitchRef.current - event.movementY * 0.00165));
        return;
      }
      if (!aiming.current) return;
      const dx = event.clientX - lastPointer.current.x;
      const dy = event.clientY - lastPointer.current.y;
      lastPointer.current.set(event.clientX, event.clientY);
      game.yawRef.current -= dx * 0.002;
      game.pitchRef.current = Math.max(-0.68, Math.min(0.6, game.pitchRef.current - dy * 0.00165));
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      aiming.current = false;
      shooting.current = false;
      canvas.style.cursor = '';
      window.dispatchEvent(new CustomEvent('game-aim-state', { detail: { active: false } }));
    };
    const unlock = () => {
      if (document.pointerLockElement !== canvas) {
        shooting.current = false;
        aiming.current = false;
        canvas.style.cursor = '';
        window.dispatchEvent(new CustomEvent('game-aim-state', { detail: { active: false } }));
      }
    };
    canvas.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
    document.addEventListener('mousemove', move);
    document.addEventListener('pointerlockchange', unlock);
    document.addEventListener('keydown', keyDown);
    return () => {
      canvas.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('pointerlockchange', unlock);
      document.removeEventListener('keydown', keyDown);
      canvas.style.cursor = '';
    };
  }, [gl, game.pitchRef, game.yawRef, shoot]);

  return <>
    <Player game={game} controlsEnabled={!multiplayer || matchActive}/>
    {!multiplayer && <Targets targets={game.snapshot.targetStates}/>}
    <Effects shots={shots}/><PresentationEffects/>
    <AutoFire shooting={shooting} nextShotAt={nextShotAt} shoot={shoot} game={game}/>
    {!multiplayer && <Threats game={game}/>}
  </>;
}

function AutoFire({ shooting, nextShotAt, shoot, game }: { game: GameApi; shooting: React.MutableRefObject<boolean>; nextShotAt: React.MutableRefObject<Record<WeaponId, number>>; shoot: () => void }) {
  useFrame(() => {
    const now = performance.now();
    if (shooting.current && WEAPONS[game.weaponRef.current].automatic && now >= nextShotAt.current[game.weaponRef.current]) {
      shoot();
    }
  });
  return null;
}

function Threats({ game }: { game: GameApi }) {
  const lastHitAt = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (now - lastHitAt.current < 4400) return;
    const player = game.playerRef.current;
    const inRange = game.snapshot.targetStates.some((target) => target.alive && Math.hypot(target.position[0] - player.x, target.position[2] - player.z) < 8.2);
    if (inRange) { game.damage(5); lastHitAt.current = now; }
  });
  return null;
}

export default function GameScene({ game, session, localPlayerId, motionMap, matchActive = true, fireAuthoritative, reloadAuthoritative }: { game: GameApi; session: GameSession | null; localPlayerId: string | null; motionMap: MutableRefObject<Map<string, MovementPacket>>; matchActive?: boolean; fireAuthoritative?: (weapon: WeaponId, direction: [number, number, number]) => void; reloadAuthoritative?: () => void }) {
  return <Canvas shadows camera={{ position: [0, 3, 5], fov: 68, near: 0.1, far: 90 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
    <color attach="background" args={['#0a1119']}/>
    <fog attach="fog" args={['#0a1119', 34, 64]}/>
    <ambientLight intensity={0.82}/>
    <hemisphereLight args={['#8dc7d4', '#243641', 0.8]}/>
    <directionalLight position={[7, 18, 4]} intensity={2.25} castShadow shadow-mapSize={[1024, 1024]}/>
    <directionalLight position={[-10, 8, -12]} color="#70a9c6" intensity={0.52}/>
    <Suspense fallback={null}><Arena/><Controls game={game} multiplayer={Boolean(session)} matchActive={matchActive} fireAuthoritative={fireAuthoritative} reloadAuthoritative={reloadAuthoritative}/>{session&&localPlayerId&&<RemotePlayers players={session.players} playerId={localPlayerId} motionMap={motionMap}/>}</Suspense>
  </Canvas>;
}
