import { localFeedback } from '../presentation/events';
import WeaponModel from './WeaponModel';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Group, MathUtils, Vector3 } from 'three';
import { ARENA_BOXES, ARENA_RAMPS, FLAT_SURFACES, intersectBox, intersectRamp, rampSurfaceAt } from '../game/arenaLayout';
import JetpackEffect from './JetpackEffect';
import { MOBILITY } from '../game/mobility';
import { ARENA_LIMIT } from '../game/constants';
import type { GameApi } from '../game/types';

const pressed = new Set<string>();
const PLAYER_RADIUS = 0.34;
const PLAYER_HEIGHT = 1.9;
function blockedAt(x: number, z: number, feetY: number, step = false) {
  return ARENA_BOXES.some((box) => {
    if (box.id === 'floor' || box.solid === false) return false;
    const [cx, cy, cz] = box.position;
    const [sx, sy, sz] = box.size;
    const inside = Math.abs(x - cx) < sx / 2 + PLAYER_RADIUS && Math.abs(z - cz) < sz / 2 + PLAYER_RADIUS;
    const bottom = cy - sy / 2;
    const top = cy + sy / 2;
    if (step && top <= feetY + 0.25) return false;
    return inside && feetY < top - 0.03 && feetY + PLAYER_HEIGHT > bottom + 0.04;
  });
}
function getSupportHeight(x: number, z: number, previousY: number) {
  let highest: number | null = null;
  for (const surface of FLAT_SURFACES) {
    if (Math.abs(x - surface.x) <= surface.halfX && Math.abs(z - surface.z) <= surface.halfZ && surface.height <= previousY + 0.25 && (highest === null || surface.height > highest)) highest = surface.height;
  }
  const rampHeight = rampSurfaceAt(x, z);
  if (rampHeight !== null && rampHeight <= previousY + 0.25 && (highest === null || rampHeight > highest)) highest = rampHeight;
  return highest ?? 0;
}

export default function Player({ game, controlsEnabled = true }: { game: GameApi; controlsEnabled?: boolean }) {
  const group = useRef<Group>(null);
  const weapon = useRef<Group>(null);
  const jetActive = useRef(false);
  const jetStrength = useRef(1);
  const lastBurstVisual = useRef(false);
  const weaponChangedAt = useRef(0);
  useEffect(() => { weaponChangedAt.current = performance.now(); }, [game.snapshot.weapon]);
  const fuelLock = useRef(false);
  const recoveryDelay = useRef(0);
  const burstQueued = useRef(false);
  const lastSpaceAt = useRef(-10);
  const burstCooldown = useRef(0);
  const burstVisual = useRef(0);
  const landingFeedback = useRef(0);
  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  const input = useRef(new Vector3());
  const focus = useRef(new Vector3());
  const desiredCamera = useRef(new Vector3());
  const cameraVector = useRef(new Vector3());
  const lookDirection = useRef(new Vector3());
  const cameraTarget = useRef(new Vector3());
  const muzzleFlash = useRef<Group>(null);
  const velocity = game.velocityRef;
  const grounded = game.groundedRef;
  const jumpQueued = useRef(false);
  const wasAlive = useRef(true);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const alreadyDown = pressed.has(event.code);
      pressed.add(event.code);
      if (event.code === 'Space' && !alreadyDown && !event.repeat) {
        jumpQueued.current = true;
        const now = performance.now() / 1000;
        burstQueued.current = now - lastSpaceAt.current < 0.28;
        lastSpaceAt.current = now;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => { pressed.delete(event.code); if (event.code === 'Space') fuelLock.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const clear = () => { pressed.clear(); jumpQueued.current = false; burstQueued.current = false; lastSpaceAt.current = -10; };
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); pressed.clear(); };
  }, []);

  useFrame((state, frameDt) => {
    const alive = game.snapshot.hp > 0;
    const enabled = controlsEnabled && alive;
    if (alive && !wasAlive.current) { fuelLock.current = false; recoveryDelay.current = 0; burstCooldown.current = 0; burstVisual.current = 0; lastSpaceAt.current = -10; }
    wasAlive.current = alive;
    const dt = Math.min(frameDt, 0.04);
    if (!enabled) { velocity.current.set(0, 0, 0); jumpQueued.current = false; burstQueued.current = false; }
    const player = game.playerRef.current;
    // Boundaries prevent falls; recover invalid local coordinates without altering server HP.
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(player.z)) player.set(-4, 0, 5);
    player.x = MathUtils.clamp(player.x, -ARENA_LIMIT, ARENA_LIMIT);
    player.z = MathUtils.clamp(player.z, -ARENA_LIMIT, ARENA_LIMIT);
    player.y = MathUtils.clamp(player.y, 0, MOBILITY.ceiling);
    const wasGrounded = grounded.current;
    const spaceDown = pressed.has('Space');
    if (game.fuelRef.current <= 0) fuelLock.current = true;
    const boosting = enabled && spaceDown && !fuelLock.current && game.fuelRef.current > 0 && player.y < MOBILITY.ceiling;
    burstCooldown.current = Math.max(0, burstCooldown.current - dt);
    burstVisual.current = Math.max(0, burstVisual.current - dt);
    const f = forward.current.set(-Math.sin(game.yawRef.current), 0, -Math.cos(game.yawRef.current));
    const r = right.current.set(Math.cos(game.yawRef.current), 0, -Math.sin(game.yawRef.current));
    const move = input.current.set(0, 0, 0);
    if (enabled) {
      if (pressed.has('KeyW') || pressed.has('ArrowUp')) move.add(f);
      if (pressed.has('KeyS') || pressed.has('ArrowDown')) move.sub(f);
      if (pressed.has('KeyD') || pressed.has('ArrowRight')) move.add(r);
      if (pressed.has('KeyA') || pressed.has('ArrowLeft')) move.sub(r);
    }
    if (move.lengthSq() > 0) move.normalize();
    const air = !grounded.current;
    const maxSpeed = air ? MOBILITY.airSpeed : MOBILITY.groundSpeed;
    const acceleration = air ? MOBILITY.airAcceleration : MOBILITY.groundAcceleration;
    const drag = air ? MOBILITY.airDrag : MOBILITY.groundDrag;
    velocity.current.x = MathUtils.damp(velocity.current.x, move.x * maxSpeed, move.lengthSq() ? acceleration : drag, dt);
    velocity.current.z = MathUtils.damp(velocity.current.z, move.z * maxSpeed, move.lengthSq() ? acceleration : drag, dt);
    if (enabled && jumpQueued.current && grounded.current && game.fuelRef.current >= MOBILITY.restartFuel) {
      game.consumeFuel(3);
      recoveryDelay.current = MOBILITY.recoveryDelay;
      velocity.current.y = MOBILITY.launchSpeed;
      grounded.current = false;
    }
    jumpQueued.current = false;
    if (enabled) velocity.current.y = Math.max(-MOBILITY.descentSpeed, velocity.current.y - MOBILITY.gravity * dt);
    if (boosting) {
      velocity.current.y = Math.min(burstVisual.current > 0 ? 6.2 : MOBILITY.ascentSpeed, velocity.current.y + MOBILITY.thrust * dt);
      game.consumeFuel(MOBILITY.fuelDrain * dt);
      recoveryDelay.current = MOBILITY.recoveryDelay;
    } else {
      recoveryDelay.current = Math.max(0, recoveryDelay.current - dt);
      if (enabled && recoveryDelay.current === 0 && (!spaceDown || grounded.current)) {
        game.restoreFuel((grounded.current ? MOBILITY.groundRecovery : MOBILITY.airRecovery) * dt);
      }
    }
    if (enabled && burstQueued.current && player.y < MOBILITY.ceiling && burstCooldown.current === 0 && game.fuelRef.current >= MOBILITY.burstFuel) {
      game.consumeFuel(MOBILITY.burstFuel);
      velocity.current.y = Math.min(6.2, Math.max(2, velocity.current.y) + 2.2);
      velocity.current.x += move.x * 1.8;
      velocity.current.z += move.z * 1.8;
      burstCooldown.current = MOBILITY.burstCooldown;
      burstVisual.current = 0.18;
      recoveryDelay.current = MOBILITY.recoveryDelay;
    }
    burstQueued.current = false;

    const previousY = player.y;
    const nextX = MathUtils.clamp(player.x + velocity.current.x * dt, -ARENA_LIMIT, ARENA_LIMIT);
    const nextZ = MathUtils.clamp(player.z + velocity.current.z * dt, -ARENA_LIMIT, ARENA_LIMIT);
    if (!blockedAt(nextX, player.z, player.y, grounded.current)) player.x = nextX;
    else velocity.current.x = 0;
    if (!blockedAt(player.x, nextZ, player.y, grounded.current)) player.z = nextZ;
    else velocity.current.z = 0;

    const fallingSpeed = velocity.current.y;
    player.y = Math.min(MOBILITY.ceiling, player.y + velocity.current.y * dt);
    if (player.y >= MOBILITY.ceiling) velocity.current.y = Math.min(0, velocity.current.y);
    // Stop the head at undersides instead of passing through decks during ascent.
    if (velocity.current.y > 0) for (const box of ARENA_BOXES) {
      const bottom = box.position[1] - box.size[1] / 2;
      if (Math.abs(player.x - box.position[0]) < box.size[0] / 2 + PLAYER_RADIUS &&
          Math.abs(player.z - box.position[2]) < box.size[2] / 2 + PLAYER_RADIUS &&
          previousY + PLAYER_HEIGHT <= bottom && player.y + PLAYER_HEIGHT >= bottom) {
        player.y = bottom - PLAYER_HEIGHT; velocity.current.y = 0;
      }
    }
    const support = getSupportHeight(player.x, player.z, previousY);
    const walkingOntoSlope = grounded.current && !boosting && support > previousY - 0.12;
    if (player.y <= support || (walkingOntoSlope && player.y < support + 0.25)) {
      if (!wasGrounded && fallingSpeed < -3) {
        landingFeedback.current = Math.min(0.055, -fallingSpeed * 0.004);
        localFeedback({type:'landing',position:[player.x,support,player.z]});
      }
      player.y = support;
      velocity.current.y = 0;
      grounded.current = true;
    } else {
      grounded.current = false;
    }

    landingFeedback.current *= Math.exp(-18 * dt);
    const shotAge = game.lastShotAtRef.current ? (performance.now() - game.lastShotAtRef.current) / 1000 : 5;
    const recoil = Math.exp(-shotAge * 15) * (game.weaponRef.current === 'SH8' ? 0.09 : 0.035);
    const lookPitch = game.pitchRef.current - recoil;
    const pitchCos = Math.cos(lookPitch);
    const look = lookDirection.current.set(-Math.sin(game.yawRef.current) * pitchCos, Math.sin(lookPitch), -Math.cos(game.yawRef.current) * pitchCos).normalize();

    const focal = focus.current.copy(player); focal.y += 1.16;
    const desired = desiredCamera.current.copy(player)
      .addScaledVector(f, -5.8)
      .addScaledVector(r, 1.18);
    desired.y += 2.34;
    const cam = cameraVector.current.copy(desired).sub(focal);
    const cameraDistance = cam.length();
    cam.normalize();
    let safeDistance = cameraDistance;
    for (const box of ARENA_BOXES) {
      const hitDistance = intersectBox(focal, cam, box);
      if (hitDistance !== null && hitDistance > 0.15) safeDistance = Math.min(safeDistance, hitDistance - 0.25);
    }
    for (const ramp of ARENA_RAMPS) {
      const hitDistance = intersectRamp(focal, cam, ramp);
      if (hitDistance !== null && hitDistance > 0.15) safeDistance = Math.min(safeDistance, hitDistance - 0.25);
    }
    desired.copy(focal).addScaledVector(cam, Math.max(0.35, safeDistance));
    state.camera.position.lerp(desired, 1 - Math.exp(-(safeDistance < cameraDistance ? 32 : boosting ? 18 : 14) * dt));
    // Retract immediately if smoothing would leave the camera inside cover.
    cam.copy(state.camera.position).sub(focal).normalize();
    let actualDistance = state.camera.position.distanceTo(focal);
    for (const box of ARENA_BOXES) {
      const hit = intersectBox(focal, cam, box);
      if (hit !== null && hit > 0.15) actualDistance = Math.min(actualDistance, Math.max(0.35, hit - 0.25));
    }
    for (const ramp of ARENA_RAMPS) {
      const hit = intersectRamp(focal, cam, ramp);
      if (hit !== null && hit > 0.15) actualDistance = Math.min(actualDistance, Math.max(0.35, hit - 0.25));
    }
    state.camera.position.copy(focal).addScaledVector(cam, actualDistance);
    state.camera.lookAt(cameraTarget.current.copy(focal).addScaledVector(look, 40));
    state.camera.updateMatrixWorld();
    state.camera.getWorldDirection(game.aimDirectionRef.current);

    const characterYaw = Math.atan2(-game.aimDirectionRef.current.x, -game.aimDirectionRef.current.z);
    const motion = game.motionRef.current;
    motion.x = player.x; motion.y = player.y; motion.z = player.z;
    motion.yaw = characterYaw; motion.velocityX = velocity.current.x; motion.velocityY = velocity.current.y; motion.velocityZ = velocity.current.z;
    motion.grounded = grounded.current; motion.jetpackActive = boosting || (enabled && burstVisual.current > 0);
    if (group.current) {
      group.current.position.copy(player);
      group.current.scale.y = 1 - landingFeedback.current;
      group.current.rotation.y = characterYaw;
      group.current.visible = game.snapshot.hp > 0;
    }
    if (weapon.current) {
      const shotKick=Math.exp(-shotAge*22)*(game.weaponRef.current==='SH8'?0.15:0.065);
      const switchDip=Math.max(0,1-(performance.now()-weaponChangedAt.current)/170);
      const reloadDip=game.snapshot.reloading?Math.sin(game.snapshot.reloadProgress*Math.PI)*0.28:0;
      weapon.current.rotation.x=Math.asin(MathUtils.clamp(game.aimDirectionRef.current.y,-0.8,0.8))+shotKick-reloadDip;
      weapon.current.position.y=1.12-switchDip*0.13-reloadDip*0.2;
      weapon.current.position.z=-0.12+shotKick*0.7;
    }
    if (jetActive.current !== motion.jetpackActive) localFeedback({type:motion.jetpackActive?'boost-start':'boost-end'});
    const burstOn=enabled && burstVisual.current>0;
    if(burstOn && !lastBurstVisual.current)localFeedback({type:'burst'});
    lastBurstVisual.current=burstOn;jetStrength.current=burstOn?1.6:1;
    jetActive.current = motion.jetpackActive;
    if (muzzleFlash.current) {
      muzzleFlash.current.visible = shotAge < (game.weaponRef.current === 'SH8' ? 0.085 : 0.045);
      const flashScale = (game.weaponRef.current === 'SH8' ? 1.3 : 0.7) + Math.sin(shotAge * 180) * 0.25;
      muzzleFlash.current.scale.setScalar(flashScale);
    }
  });

  return <group ref={group}>
    <mesh position={[0, 0.78, 0]} castShadow><capsuleGeometry args={[0.43, 0.78, 5, 10]}/><meshStandardMaterial color="#d9e5e4" metalness={0.18} roughness={0.4}/></mesh>
    <mesh position={[0, 1.56, 0]} castShadow><sphereGeometry args={[0.32, 20, 16]}/><meshStandardMaterial color="#e7ba91" roughness={0.7}/></mesh>
    <mesh position={[0, 1.58, -0.285]}><boxGeometry args={[0.48, 0.145, 0.1]}/><meshStandardMaterial color="#27d8ca" emissive="#11716c" emissiveIntensity={0.7}/></mesh>
    <mesh position={[0, 0.62, 0.47]} castShadow><boxGeometry args={[0.72, 0.96, 0.42]}/><meshStandardMaterial color="#2d6575" metalness={0.48} roughness={0.42}/></mesh>
    <mesh position={[-0.27, 0.65, 0.61]}><boxGeometry args={[0.12, 0.54, 0.13]}/><meshStandardMaterial color="#d3a657" metalness={0.58}/></mesh>
    <mesh position={[0.27, 0.65, 0.61]}><boxGeometry args={[0.12, 0.54, 0.13]}/><meshStandardMaterial color="#d3a657" metalness={0.58}/></mesh>
    <mesh position={[0.37, 1.03, -0.04]} rotation={[-Math.PI / 2, 0, 0]} castShadow><capsuleGeometry args={[0.13, 0.4, 4, 7]}/><meshStandardMaterial color="#c7d5d4"/></mesh>
    <mesh position={[-0.38, 1.03, -0.02]} rotation={[-Math.PI / 2, 0, 0]} castShadow><capsuleGeometry args={[0.13, 0.4, 4, 7]}/><meshStandardMaterial color="#c7d5d4"/></mesh>
    <group ref={weapon} position={[0.5, 1.12, -0.12]}>
      <WeaponModel weapon={game.snapshot.weapon}/>
      <group ref={muzzleFlash} position={[0, 0, -0.7]}>
        <mesh><sphereGeometry args={[0.15, 8, 8]}/><meshBasicMaterial color="#fff1b1" transparent opacity={0.9} toneMapped={false}/></mesh>
        <pointLight color="#ffca70" intensity={1.5} distance={2.5}/>
      </group>
    </group>
    <JetpackEffect active={jetActive} strength={jetStrength}/>
  </group>;
}
