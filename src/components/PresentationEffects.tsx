import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MeshBasicMaterial } from 'three';
import type { CombatEvent, Vec3Tuple } from '../multiplayer/types';
import { COMBAT_FEEDBACK, LOCAL_FEEDBACK, type LocalFeedback } from '../presentation/events';

type Pulse = { id: string; position: Vec3Tuple; at: number; kind: 'hit' | 'spawn' | 'landing' };
export default function PresentationEffects() {
  const [pulses,setPulses]=useState<Pulse[]>([]);
  useEffect(()=>{
    const add=(pulse: Pulse)=>setPulses(current=>[...current.filter(item=>performance.now()-item.at<600).slice(-7),pulse]);
    const combat=(event: Event)=>{
      const data=(event as CustomEvent<CombatEvent>).detail;
      if (!data.player) return;
      if (data.type==='player_damaged') add({id:data.event_id,position:[data.player.position[0],data.player.position[1]+1.05,data.player.position[2]],at:performance.now(),kind:'hit'});
      if (data.type==='player_respawned') add({id:data.event_id,position:data.player.position,at:performance.now(),kind:'spawn'});
    };
    const local=(event: Event)=>{
      const data=(event as CustomEvent<LocalFeedback>).detail;
      if(data.type==='landing' || data.type==='spawn')add({id:String(performance.now()),position:data.position,at:performance.now(),kind:data.type==='spawn'?'spawn':'landing'});
    };
    window.addEventListener(COMBAT_FEEDBACK,combat);window.addEventListener(LOCAL_FEEDBACK,local);
    return ()=>{window.removeEventListener(COMBAT_FEEDBACK,combat);window.removeEventListener(LOCAL_FEEDBACK,local);};
  },[]);
  return <>{pulses.map(pulse=><EnergyPulse key={pulse.id} pulse={pulse}/>)}</>;
}
function EnergyPulse({pulse}:{pulse:Pulse}) {
  const root=useRef<Group>(null), material=useRef<MeshBasicMaterial>(null);
  useFrame(()=>{
    const life=pulse.kind==='hit'?220:550, progress=(performance.now()-pulse.at)/life;
    if(!root.current || !material.current)return;
    root.current.visible=progress<1;root.current.scale.setScalar(pulse.kind==='hit'?0.18+progress*0.45:0.45+progress*1.15);
    material.current.opacity=Math.max(0,(1-progress)*(pulse.kind==='hit'?0.8:0.45));
  });
  return <group ref={root} position={pulse.position}>
    <mesh rotation={pulse.kind==='hit'?[0,0,0]:[-Math.PI/2,0,0]} position={[0,pulse.kind==='hit'?0:0.03,0]}>
      {pulse.kind==='hit'?<icosahedronGeometry args={[1,0]}/>:<ringGeometry args={[0.83,1,24]}/>}
      <meshBasicMaterial ref={material} color={pulse.kind==='hit'?'#fff1b8':'#69e2ef'} transparent depthWrite={false} toneMapped={false} side={2}/>
    </mesh>
  </group>;
}
