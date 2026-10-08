import type { RealtimeChannel } from '@supabase/supabase-js';
import type { MovementPacket } from './types';

export const MOVEMENT_SEND_INTERVAL_MS = 50;
export const GAME_CHECKPOINT_INTERVAL_MS = 1000;

export function playerMovementTopic(gameId: string, playerId: string) {
  return `game:${gameId}:player:${playerId}`;
}

export function publishMovement(channel: RealtimeChannel, packet: MovementPacket) {
  return channel.send({ type: 'broadcast', event: 'movement', payload: packet });
}

export function parseMovement(value: unknown): MovementPacket | null {
  if (!value || typeof value !== 'object') return null;
  const packet = value as Partial<MovementPacket>;
  if (![packet.x, packet.y, packet.z, packet.yaw, packet.velocity_y, packet.sequence, packet.sent_at].every(Number.isFinite)) return null;
  if (typeof packet.grounded !== 'boolean' || typeof packet.jetpack_active !== 'boolean') return null;
  if (Math.abs(packet.x!) > 21 || packet.y! < -1 || packet.y! > 45 || Math.abs(packet.z!) > 21 || Math.abs(packet.velocity_y!) > 12) return null;
  return packet as MovementPacket;
}
