import type { WeaponId } from '../game/weapons';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, Color, Float32BufferAttribute, LineSegments, LineBasicMaterial, Vector3 } from 'three';
export type Shot = { weapon?: WeaponId; id: number; from: Vector3; to: Vector3; created: number; hit: boolean };
export default function Effects({ shots }: { shots: Shot[] }) {
  const batches = useMemo(() => {
    const grouped = new Map<number, Shot[]>();
    for (const shot of shots) { const group=grouped.get(shot.created) ?? []; group.push(shot); grouped.set(shot.created,group); }
    return [...grouped.entries()];
  }, [shots]);
  return <>{batches.map(([created, batch]) => <Tracers key={created} shots={batch} created={created}/>)}</>;
}
// All eight SH-8 pellets share a single transient geometry and draw call.
function Tracers({ shots, created }: { shots: Shot[]; created: number }) {
  const object = useMemo(() => {
    const positions: number[] = [], colors: number[] = [];
    for (const shot of shots) {
      positions.push(...shot.from.toArray(),...shot.to.toArray());
      const color=new Color(shot.hit ? '#fff0ac' : shot.weapon==='SH8' ? '#ffb975' : '#9ceee5');
      colors.push(color.r,color.g,color.b,color.r,color.g,color.b);
    }
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
    return new LineSegments(geometry,new LineBasicMaterial({vertexColors:true,transparent:true,opacity:0.8,toneMapped:false,depthWrite:false}));
  }, [shots]);
  useEffect(() => () => { object.geometry.dispose(); (object.material as LineBasicMaterial).dispose(); }, [object]);
  useFrame(() => {
    const age=(performance.now()-created)/1000;
    object.visible=age<0.15;
    (object.material as LineBasicMaterial).opacity=Math.max(0,0.85*(1-age/0.15));
  });
  return <primitive object={object}/>;
}
