import type { WeaponId } from '../game/weapons';
import { requirePlayer, supabase } from './client';
import type { CombatEvent, GamePlayer, GameSession, LobbyRoom, MatchSnapshot, MovementPacket } from './types';

export class RoomRequestError extends Error {
  constructor(public readonly noActiveMatch: boolean, message: string) { super(message); }
}
const playerErrors = new Set([
  'Room code not found', 'This room is full', 'This room is no longer accepting players',
  'Leave your current room before joining another', 'Display name must be 1–24 characters',
  'No active room membership', 'No room membership', 'No active match session',
  'Only the room host can start a match', 'At least 2 active players must all be ready',
  'A match is already underway', 'Only the host can return a finished match to the lobby',
  'Match is not active', 'Player is dead or unavailable',
]);

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  await requirePlayer();
  if (!supabase) throw new Error('Multiplayer is temporarily unavailable. Please try again later.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new RoomRequestError(error.code === 'P0001' && error.message === 'No active match session',
    error.code === 'P0001' && playerErrors.has(error.message) ? error.message : 'Unable to reach the game service. Please try again.');
  return data as T;
}

export const createRoom = (displayName: string) => rpc<LobbyRoom>('create_room', { p_display_name: displayName });
export const joinRoom = (code: string, displayName: string) => rpc<LobbyRoom>('join_room', { p_code: code.toUpperCase().replace(/[^A-Z0-9]/g, ''), p_display_name: displayName });
export const setReady = (ready: boolean) => rpc<LobbyRoom>('set_ready', { p_is_ready: ready });
export const leaveRoom = () => rpc<boolean>('leave_room');
export const heartbeat = () => rpc<LobbyRoom | null>('heartbeat');
export const startMatch = () => rpc<LobbyRoom>('start_match');
export const returnToLobby = () => rpc<LobbyRoom>('return_to_lobby');
export const getMyRoom = () => rpc<LobbyRoom | null>('get_my_room');
export const getGameSession = () => rpc<GameSession>('get_game_session');
export const getMatchState = () => rpc<MatchSnapshot>('get_match_state');
export const persistPlayerMotion = (packet: MovementPacket) => rpc<boolean>('persist_game_player_state', {
  p_x: packet.x, p_y: packet.y, p_z: packet.z, p_rotation_y: packet.yaw,
  p_velocity_y: packet.velocity_y, p_grounded: packet.grounded,
  p_jetpack_active: packet.jetpack_active,
});
export const requestPlayerShot = (weapon: WeaponId, direction: [number, number, number]) => rpc<{ accepted: boolean; reason?: string; hit?: boolean; player?: GamePlayer; events: CombatEvent[] }>('request_player_shot', {
  p_weapon: weapon, p_dx: direction[0], p_dy: direction[1], p_dz: direction[2],
});
export const requestRespawn = () => rpc<{ accepted: boolean; reason?: string; retry_after_ms?: number; events: CombatEvent[] }>('respawn_game_player');

export const switchWeapon = (weapon: WeaponId) => rpc<GamePlayer>('switch_weapon', { p_weapon: weapon });
export const reloadWeapon = () => rpc<GamePlayer>('reload_weapon');
export const getWeaponState = () => rpc<GamePlayer>('get_weapon_state');
