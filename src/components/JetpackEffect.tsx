import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Group, Mesh } from 'three';

// A fixed six-particle exhaust: no emitters, allocations, or network messages.
export default function JetpackEffect({ active, strength }: { active: MutableRefObject<boolean>; strength?: MutableRefObject<number> }) {
  const root = useRef<Group>(null);
  const particles = useRef<(Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    if (!root.current) return;
    root.current.visible = active.current;
    if (!active.current) return;
    const time = clock.elapsedTime;
    for (let i = 0; i < particles.current.length; i++) {
      const particle = particles.current[i];
      if (!particle) continue;
      const age = (time * 2.6 + i / 6) % 1;
      particle.position.set((i % 2 ? 0.23 : -0.23) + Math.sin(time * 12 + i) * age * 0.06, -age * 1.05, 0);
      particle.scale.setScalar((1 - age) * 0.8 + 0.15);
    }
    const intensity=strength?.current ?? 1;
    root.current.scale.set(1+(intensity-1)*0.25,(0.93+Math.sin(time*38)*0.07)*intensity,1);
  });
  return <group ref={root} position={[0, 0.12, 0.55]} visible={false}>
    {[-0.23, 0.23].map((x) => <mesh key={x} position={[x, -0.18, 0]} rotation={[Math.PI, 0, 0]}>
      <coneGeometry args={[0.11, 0.5, 7]}/><meshBasicMaterial color="#6cffe5" transparent opacity={0.65} depthWrite={false} toneMapped={false}/>
    </mesh>)}
    {Array.from({ length: 6 }, (_, i) => <mesh key={i} ref={(mesh) => { particles.current[i] = mesh; }}>
      <sphereGeometry args={[0.045, 5, 4]}/><meshBasicMaterial color="#87fff0" transparent opacity={0.55} depthWrite={false} toneMapped={false}/>
    </mesh>)}
    <pointLight position={[0, 0.3, 0]} color="#37e2d0" intensity={1.5} distance={2.4}/>
  </group>;
}
