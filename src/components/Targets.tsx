import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Group, MathUtils } from 'three';
import type { TargetState } from '../game/types';

function Dummy({ target }: { target: TargetState }) {
  const group = useRef<Group>(null);
  const hitStarted = useRef(target.lastHitAt);
  useFrame((state) => {
    const object = group.current;
    if (!object) return;
    const now = performance.now();
    if (target.lastHitAt !== hitStarted.current) hitStarted.current = target.lastHitAt;
    const hitAge = (now - hitStarted.current) / 1000;
    const recoil = hitAge >= 0 && hitAge < 0.22 ? Math.sin((1 - hitAge / 0.22) * Math.PI) : 0;
    object.position.y = target.position[1] + Math.sin(state.clock.elapsedTime * 1.15 + target.id) * 0.035;
    object.rotation.y = Math.sin(state.clock.elapsedTime * 0.32 + target.id) * 0.11;
    object.rotation.x = recoil * 0.22;
    object.scale.setScalar(1 + recoil * 0.08);
  });
  return <group ref={group} position={target.position} userData={{ targetId: target.id }}>
    <mesh position={[0, 0.72, 0]} castShadow><capsuleGeometry args={[0.42, 0.56, 5, 9]}/><meshStandardMaterial color="#df7258" emissive="#59281f" emissiveIntensity={0.45}/></mesh>
    <mesh position={[0, 1.55, 0]} castShadow><sphereGeometry args={[0.34, 16, 12]}/><meshStandardMaterial color="#f3be84"/></mesh>
    <mesh position={[0, 1.56, -0.31]}><boxGeometry args={[0.49, 0.13, 0.075]}/><meshBasicMaterial color="#ffcb54"/></mesh>
    <mesh position={[0, 0.68, -0.44]}><boxGeometry args={[0.54, 0.14, 0.05]}/><meshBasicMaterial color="#101d27"/></mesh>
    <mesh position={[-0.05 + 0.27 * (1 - MathUtils.clamp(target.health / 100, 0, 1)), 0.68, -0.405]}>
      <boxGeometry args={[0.46 * MathUtils.clamp(target.health / 100, 0, 1), 0.075, 0.045]}/><meshBasicMaterial color="#65e4b7"/>
    </mesh>
    <mesh position={[0, 0.07, 0]}><cylinderGeometry args={[0.5, 0.58, 0.12, 16]}/><meshStandardMaterial color="#3c5561" metalness={0.5}/></mesh>
    <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.55, 0.62, 24]}/><meshBasicMaterial color="#e17857" transparent opacity={0.65} side={2}/></mesh>
  </group>;
}

function DestructionBurst({ target }: { target: TargetState }) {
  const age = (performance.now() - target.destroyedAt) / 1000;
  if (age > 0.48) return null;
  const size = 0.25 + age * 2.4;
  return <group position={[target.position[0], target.position[1] + 1.1 + age, target.position[2]]}>
    <mesh scale={size}><icosahedronGeometry args={[0.32, 0]}/><meshBasicMaterial color="#ffb875" transparent opacity={1 - age / 0.48} toneMapped={false}/></mesh>
    <mesh scale={size * 1.7}><sphereGeometry args={[0.2, 8, 8]}/><meshBasicMaterial color="#45d8ca" transparent opacity={(1 - age / 0.48) * 0.6} wireframe/></mesh>
  </group>;
}

export default function Targets({ targets }: { targets: TargetState[] }) {
  return <>{targets.map((target) => target.alive
    ? <Dummy key={target.id} target={target}/>
    : <DestructionBurst key={target.id} target={target}/>)}</>;
}
