import type { WeaponId } from '../game/weapons';
import type { CombatEvent, Vec3Tuple } from '../multiplayer/types';
export type LocalFeedback =
  | { type: 'shot'; weapon: WeaponId }
  | { type: 'boost-start' | 'boost-end' | 'burst' }
  | { type: 'landing' | 'spawn'; position: Vec3Tuple };
export const LOCAL_FEEDBACK = 'game-local-feedback';
export const COMBAT_FEEDBACK = 'game-combat-feedback';
export function localFeedback(detail: LocalFeedback) { window.dispatchEvent(new CustomEvent(LOCAL_FEEDBACK, { detail })); }
export function combatFeedback(detail: CombatEvent) { window.dispatchEvent(new CustomEvent(COMBAT_FEEDBACK, { detail })); }
