import { Grid } from '@react-three/drei';
import { ARENA_BOXES, ARENA_RAMPS, SPAWNS } from '../game/arenaLayout';

function Accent({ position, size, color = '#37cfc1' }: { position: [number, number, number]; size: [number, number, number]; color?: string }) {
  return <mesh position={position}><boxGeometry args={size}/><meshBasicMaterial color={color} toneMapped={false}/></mesh>;
}

export default function Arena() {
  return <group>
    {SPAWNS.map(([x,y,z],index)=><group key={`spawn-${index}`} position={[x,y+0.018,z]}>
      <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[0.7,0.78,32]}/><meshBasicMaterial color="#3c9fa7" transparent opacity={0.55} depthWrite={false}/></mesh>
      {[-1,1].map(side=><Accent key={side} position={[side*0.9,0.02,0]} size={[0.08,0.03,0.4]} color="#72c3ca"/>)}
    </group>)}
    {ARENA_BOXES.map((box) => <group key={box.id}>
      <mesh position={box.position} castShadow={box.id !== 'floor'} receiveShadow>
        <boxGeometry args={box.size}/>
        <meshStandardMaterial color={box.color} metalness={0.26} roughness={0.68}/>
      </mesh>
      {box.id !== 'floor' && box.size[1]>0.8 && box.size[0]<5 && box.size[2]<5 && <Accent position={[box.position[0],box.position[1]+box.size[1]/2+0.015,box.position[2]]} size={[box.size[0]*0.7,0.02,0.045]} color="#8ba8af"/>}
      {box.accent && box.id.endsWith('deck') && <Accent position={[box.position[0], box.position[1] + box.size[1] / 2 + 0.015, box.position[2]]} size={[box.size[0] * 0.88, 0.035, 0.08]}/>}
      {box.accent && box.id.endsWith('wall') && <Accent position={[box.position[0], 4.7, box.position[2]]} size={box.id.includes('wall') && box.size[0] < 1 ? [0.04, 0.06, 5.5] : [5.5, 0.06, 0.04]} color="#277c88"/>}
    </group>)}
    {ARENA_RAMPS.map((ramp) => <group key={ramp.id}>
      <mesh position={ramp.position} rotation={[ramp.rotationX, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={ramp.size}/><meshStandardMaterial color={ramp.color} metalness={0.32} roughness={0.58}/>
      </mesh>
      <group position={ramp.position} rotation={[ramp.rotationX, 0, 0]}>
        <mesh position={[0, ramp.size[1] / 2 + 0.015, 0]}>
          <boxGeometry args={[ramp.size[0] * 0.72, 0.025, ramp.size[2] * 0.86]}/><meshStandardMaterial color="#416b78" metalness={0.2} roughness={0.55}/>
        </mesh>
        {[-1, 1].map((side) => <Accent key={side} position={[side * ramp.size[0] * 0.44, ramp.size[1] / 2 + 0.025, 0]} size={[0.08, 0.035, ramp.size[2] * 0.94]} color="#39bbb6"/>)}
      </group>
    </group>)}
    <Grid position={[0, 0.012, 0]} args={[40, 40]} cellSize={2} cellThickness={0.35} cellColor="#27424e" sectionSize={8} sectionThickness={1.1} sectionColor="#267d83" fadeDistance={48} infiniteGrid={false}/>
    <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[3.6, 3.72, 64]}/><meshBasicMaterial color="#22928f" transparent opacity={0.72} side={2}/></mesh>
    <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[8.4, 8.52, 64]}/><meshBasicMaterial color="#244955" transparent opacity={0.64} side={2}/></mesh>
    <pointLight position={[-12, 5.2, 0]} color="#3bd0c8" intensity={24} distance={12}/>
    <pointLight position={[12, 5.2, 0]} color="#3bd0c8" intensity={24} distance={12}/>
    <pointLight position={[0, 6.5, -13]} color="#80b9d0" intensity={28} distance={15}/>
    <pointLight position={[0, 3.5, 14]} color="#3e96a2" intensity={15} distance={11}/>
    {[-1, 1].map((side) => <group key={side} position={[side * 19.85, 1.8, 0]}>
      <mesh><boxGeometry args={[0.08, 2.1, 1.2]}/><meshBasicMaterial color="#2bc7ba" toneMapped={false}/></mesh>
      <pointLight position={[-side * 0.7, 0.4, 0]} color="#26bfb5" intensity={3} distance={5}/>
    </group>)}
  </group>;
}
