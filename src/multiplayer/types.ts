import type { WeaponId, WeaponState } from '../game/weapons';
export type RoomStatus = 'LOBBY' | 'STARTING' | 'IN_MATCH' | 'FINISHED';
export type MatchState = 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'FINISHED' | 'RESULTS';
export interface MatchScore {
  player_id: string;
  display_name: string;
  eliminations: number;
  kills: number;
  deaths: number;
  score: number;
}
export interface MatchSnapshot {
  match_state: MatchState;
  countdown_ends_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  finished_at: string | null;
  winner_player_id: string | null;
  winner_name: string | null;
  scores: MatchScore[];
  server_now: string;
}

export interface LobbyPlayer {
  player_id: string;
  display_name: string;
  is_ready: boolean;
  joined_at: string;
  last_seen_at: string;
  is_active: boolean;
}

export type CombatEvent = {
  event_id: string;
  type: 'weapon_changed' | 'shot_fired' | 'player_damaged' | 'player_died' | 'player_respawned' | 'elimination' | 'match_countdown' | 'match_started' | 'match_finished' | 'match_results';
  game_id: string;
  shot_id?: string;
  shooter_id?: string;
  target_id?: string;
  damage?: number;
  weapon?: WeaponId;
  pellets?: { direction: Vec3Tuple; end: Vec3Tuple; target_id: string | null; hit: boolean }[];
  origin?: Vec3Tuple;
  direction?: Vec3Tuple;
  end?: Vec3Tuple;
  hit?: boolean;
  player?: GamePlayer;
  shooter?: GamePlayer;
  victim?: GamePlayer;
  match?: MatchSnapshot;
  countdown_ends_at?: string;
};

export interface LobbyRoom {
  id: string;
  code: string;
  host_player_id: string;
  status: RoomStatus;
  match_state: MatchState;
  countdown_ends_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  finished_at: string | null;
  winner_player_id: string | null;
  max_players: number;
  players: LobbyPlayer[];
}

export type Vec3Tuple = [number, number, number];

export interface GamePlayer extends WeaponState {
  player_id: string;
  display_name: string;
  spawn_position: Vec3Tuple;
  position: Vec3Tuple;
  rotation_y: number;
  velocity_y: number;
  grounded: boolean;
  jetpack_active: boolean;
  last_seen_at: string;
  is_active: boolean;
  health: number;
  kills: number;
  deaths: number;
  is_alive: boolean;
  dead_until: string | null;
}

export interface GameSession {
  game_id: string;
  room_code: string;
  host_player_id: string;
  match: MatchSnapshot;
  player_id: string;
  players: GamePlayer[];
}

export interface MovementPacket {
  x: number;
  y: number;
  z: number;
  yaw: number;
  velocity_y: number;
  grounded: boolean;
  jetpack_active: boolean;
  sequence: number;
  sent_at: number;
}
