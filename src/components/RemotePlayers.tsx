import { COMBAT_FEEDBACK } from '../presentation/events';
import type { CombatEvent } from '../multiplayer/types';
import WeaponModel from './WeaponModel';
import JetpackEffect from './JetpackEffect';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Group, MeshStandardMaterial, Vector3 } from 'three';
import type { MutableRefObject } from 'react';
import type { GamePlayer, MovementPacket } from '../multiplayer/types';

type MotionMap = Map<string, MovementPacket>;

function RemotePilot({ pilot, motionMap }: { pilot: GamePlayer; motionMap: MutableRefObject<MotionMap> }) {
  const root = useRef<Group>(null);
  const bodyMaterial = useRef<MeshStandardMaterial>(null);
  const hitAt = useRef(-1000);
  const strength = useRef(1);
  useEffect(() => {
    const hit=(event: Event)=>{const combat=(event as CustomEvent<CombatEvent>).detail;if(combat.type==='player_damaged' && combat.target_id===pilot.player_id)hitAt.current=performance.now();};
    window.addEventListener(COMBAT_FEEDBACK,hit);return()=>window.removeEventListener(COMBAT_FEEDBACK,hit);
  },[pilot.player_id]);

  const position = useRef(new Vector3(...pilot.position));
  const target = useRef(new Vector3(...pilot.position));
  const yaw = useRef(pilot.rotation_y);
  const targetYaw = useRef(pilot.rotation_y);
  const lastSequence = useRef(-1);
  const boosting = useRef(pilot.jetpack_active);

  useFrame((state, frameDt) => {
    const dt = Math.min(frameDt, 0.04);
    const packet = motionMap.current.get(pilot.player_id);
    if (packet && packet.sequence > lastSequence.current) {
      lastSequence.current = packet.sequence;
      target.current.set(packet.x, packet.y, packet.z);
      targetYaw.current = packet.yaw;
      boosting.current = packet.jetpack_active;
    }
    strength.current=boosting.current && (packet?.velocity_y ?? 0)>5?1.5:1;
    if(bodyMaterial.current)bodyMaterial.current.emissiveIntensity=0.08+Math.max(0,1-(performance.now()-hitAt.current)/220)*0.5;
    const blend = 1 - Math.exp(-13 * dt);
    position.current.lerp(target.current, blend);
    const yawDelta = Math.atan2(Math.sin(targetYaw.current - yaw.current), Math.cos(targetYaw.current - yaw.current));
    yaw.current += yawDelta * blend;
    if (root.current) {
      root.current.position.copy(position.current);
      root.current.rotation.y = yaw.current;
    }

  });

  return <group ref={root} visible={pilot.is_alive}>
    <mesh position={[0, 0.78, 0]} castShadow><capsuleGeometry args={[0.43, 0.78, 5, 10]}/><meshStandardMaterial ref={bodyMaterial} color="#bdd6dc" emissive="#68b4ba" emissiveIntensity={0.08} metalness={0.2} roughness={0.46}/></mesh>
    <mesh position={[0, 1.56, 0]} castShadow><sphereGeometry args={[0.32, 20, 16]}/><meshStandardMaterial color="#d5ab83" roughness={0.7}/></mesh>
    <mesh position={[0, 1.58, -0.285]}><boxGeometry args={[0.48, 0.145, 0.1]}/><meshStandardMaterial color="#f6bd58" emissive="#79521b" emissiveIntensity={0.65}/></mesh>
    <mesh position={[0, 0.62, 0.47]} castShadow><boxGeometry args={[0.72, 0.96, 0.42]}/><meshStandardMaterial color="#714d82" metalness={0.45} roughness={0.42}/></mesh>
    <mesh position={[-0.27, 0.65, 0.61]}><boxGeometry args={[0.12, 0.54, 0.13]}/><meshStandardMaterial color="#d3a657" metalness={0.58}/></mesh>
    <mesh position={[0.27, 0.65, 0.61]}><boxGeometry args={[0.12, 0.54, 0.13]}/><meshStandardMaterial color="#d3a657" metalness={0.58}/></mesh>
    <mesh position={[0, 0.62, 0.63]} castShadow><boxGeometry args={[0.66, 0.83, 0.29]}/><meshStandardMaterial color="#394754" metalness={0.55} roughness={0.4}/></mesh>
    <group position={[0.5,1.12,-0.12]}><WeaponModel weapon={pilot.selected_weapon ?? 'VX9'}/></group>
    <JetpackEffect active={boosting} strength={strength}/>
  </group>;
}

export default function RemotePlayers({ players, playerId, motionMap }: {
  players: GamePlayer[];
  playerId: string;
  motionMap: MutableRefObject<MotionMap>;
}) {
  const remotes = players.filter((player) => player.player_id !== playerId && player.is_active);
  return <group>{remotes.map((player) => <RemotePilot key={player.player_id} pilot={player} motionMap={motionMap}/>)}</group>;
}
