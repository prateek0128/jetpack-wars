import type { WeaponId } from '../game/weapons';
export default function WeaponModel({ weapon }: { weapon: WeaponId }) {
  const scatter = weapon === 'SH8';
  return <group>
    <mesh position={[0,0,-0.29]} castShadow><boxGeometry args={[scatter ? 0.32 : 0.26, scatter ? 0.23 : 0.18, scatter ? 0.9 : 0.66]}/><meshStandardMaterial color={scatter ? '#665444' : '#344954'} metalness={0.72} roughness={0.3}/></mesh>
    <mesh position={[0,-0.18,-0.1]} rotation={[-0.22,0,0]} castShadow><boxGeometry args={[0.17,0.34,0.2]}/><meshStandardMaterial color="#b48643" metalness={0.45}/></mesh>
    <mesh position={[0,0.14,-0.2]}><boxGeometry args={[0.13,0.055,0.2]}/><meshStandardMaterial color={scatter ? '#ffaf65' : '#4dd9ca'} emissive={scatter ? '#79451b' : '#165752'} emissiveIntensity={0.75}/></mesh>
    {scatter && <mesh position={[0,-0.1,-0.5]}><boxGeometry args={[0.36,0.12,0.24]}/><meshStandardMaterial color="#d39952"/></mesh>}
  </group>;
}
