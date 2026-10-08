import { useEffect, useRef, useState } from 'react';
import type { GameApi } from '../game/types';
import type { CombatEvent, MatchState } from '../multiplayer/types';
import { COMBAT_FEEDBACK, LOCAL_FEEDBACK, localFeedback, type LocalFeedback } from '../presentation/events';
import { isMuted, jetSound, setMuted, sound, unlockAudio } from '../presentation/audio';

type FeedEntry = { id: string; killer: string; victim: string; local: boolean; expires: number };
export function usePresentation(game: GameApi, localPlayerId: string | null, multiplayer: boolean, matchState: MatchState, countdown: number) {
  const [muted, updateMuted] = useState(isMuted);
  const [confirmedAt, setConfirmedAt] = useState(0);
  const [damageDirection,setDamageDirection] = useState<{angle:number;expires:number}|null>(null);
  const [fireAt, setFireAt] = useState(0);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [elimination, setElimination] = useState<{ name: string; expires: number } | null>(null);
  const [goUntil, setGoUntil] = useState(0);
  const [respawnAt, setRespawnAt] = useState(0);
  const [switchAt, setSwitchAt] = useState(0);
  const [loadedAt, setLoadedAt] = useState(0);
  const previous = useRef(game.snapshot);
  const previousMatch = useRef(matchState);
  const previousCount = useRef(0);
  const previousRespawnCount = useRef(0);
  const fuelTracker = useRef({ fuel: game.snapshot.fuel, recoveringUntil: 0 });
  const previousRoomPlayer = useRef(localPlayerId);

  useEffect(() => {
    const unlock = () => unlockAudio();
    const quiet = () => jetSound(false);
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('blur', quiet);
    const local = (event: Event) => {
      const feedback = (event as CustomEvent<LocalFeedback>).detail;
      if (feedback.type === 'shot') { setFireAt(performance.now()); sound(feedback.weapon); }
      if (feedback.type === 'boost-start') jetSound(true);
      if (feedback.type === 'boost-end') jetSound(false);
      if (feedback.type === 'burst') sound('burst');
      if (feedback.type === 'landing') sound('landing');
    };
    window.addEventListener(LOCAL_FEEDBACK, local);
    return () => {
      window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('blur', quiet); window.removeEventListener(LOCAL_FEEDBACK, local); quiet();
    };
  }, []);
  useEffect(() => {
    const confirmed = (event: Event) => {
      const combat = (event as CustomEvent<CombatEvent>).detail;
      if (combat.type === 'player_damaged' && combat.shooter_id === localPlayerId) { setConfirmedAt(performance.now()); sound('hit'); }
      if (combat.type==='player_damaged' && combat.target_id===localPlayerId && combat.shooter) {
        const [x,,z]=combat.shooter.position; const local=game.playerRef.current;
        setDamageDirection({angle:(game.yawRef.current-Math.atan2(-(x-local.x),-(z-local.z)))*180/Math.PI,expires:performance.now()+650});
      }
      if (combat.type === 'elimination' && combat.player && combat.victim) {
        const own = combat.player.player_id === localPlayerId;
        setFeed(current => [...current.slice(-3), { id: combat.event_id, killer: combat.player!.display_name, victim: combat.victim!.display_name, local: own || combat.victim!.player_id === localPlayerId, expires: performance.now()+4500 }]);
        if (own) { setElimination({ name: combat.victim.display_name, expires: performance.now()+1350 }); sound('elimination'); }
      }
    };
    window.addEventListener(COMBAT_FEEDBACK, confirmed);
    return () => window.removeEventListener(COMBAT_FEEDBACK, confirmed);
  }, [localPlayerId, game.playerRef, game.yawRef]);
  useEffect(() => {
    if (previousRoomPlayer.current !== localPlayerId) {
      previousRoomPlayer.current = localPlayerId; setFeed([]); setElimination(null);
    }
    const current = game.snapshot, before = previous.current;
    if (current.hp < before.hp && current.hp > 0) sound('damage');
    if (before.hp > 0 && current.hp === 0) { sound('death'); jetSound(false); }
    if (before.hp === 0 && current.hp > 0) { setRespawnAt(performance.now()); sound('respawn'); if(!multiplayer)localFeedback({type:'spawn',position:[game.playerRef.current.x,game.playerRef.current.y,game.playerRef.current.z]}); }
    if (current.weapon !== before.weapon) { setSwitchAt(performance.now()); sound('switch'); }
    if (!before.reloading && current.reloading) sound('reload');
    // A timer completing visually cannot refill ammo: wait for the existing state to confirm.
    if (before.reloading && !current.reloading && current.weapon === before.weapon && current.ammo > before.ammo) { setLoadedAt(performance.now()); sound('loaded'); }
    if (!multiplayer && current.hitAt !== before.hitAt) sound('hit');
    if (!multiplayer && current.kills > before.kills) { setElimination({ name: 'TARGET DESTROYED', expires: performance.now()+1350 }); sound('elimination'); }
    const count = current.hp === 0 ? Math.min(2,Math.ceil(current.respawnRemaining)) : 0;
    if (count > 0 && count !== previousRespawnCount.current) sound('countdown');
    previousRespawnCount.current = count;
    previous.current = current;
  }, [game.snapshot, localPlayerId, multiplayer]);
  useEffect(() => {
    if (matchState === 'COUNTDOWN') {
      if (previousMatch.current !== 'COUNTDOWN') { setFeed([]); setElimination(null); setGoUntil(0); setRespawnAt(0); }
      if (countdown > 0 && countdown !== previousCount.current) sound('countdown');
    }
    if (previousMatch.current === 'COUNTDOWN' && matchState === 'ACTIVE') { setGoUntil(performance.now()+650); sound('start'); }
    if (previousMatch.current === 'ACTIVE' && (matchState === 'FINISHED' || matchState === 'RESULTS')) { jetSound(false); sound('end'); }
    previousMatch.current = matchState; previousCount.current = countdown;
  }, [matchState, countdown]);
  const now = performance.now();
  const fuelDelta = game.snapshot.fuel-fuelTracker.current.fuel;
  if(fuelDelta>0.01)fuelTracker.current.recoveringUntil=now+180;
  fuelTracker.current.fuel=game.snapshot.fuel;
  return {
    muted, toggleSound: () => { unlockAudio(); setMuted(!muted); updateMuted(!muted); },
    firing: now-fireAt<150, fireAt, hit: multiplayer ? confirmedAt>0 && now-confirmedAt<240 : now-game.snapshot.hitAt<240 && game.snapshot.hitAt>0,
    damageDirection: damageDirection && damageDirection.expires>now ? damageDirection.angle : null,
    switching: now-switchAt<180, loaded: now-loadedAt<550,
    feed: feed.filter(item => item.expires>now), elimination: elimination && elimination.expires>now ? elimination.name : null,
    go: goUntil>now, respawning: game.snapshot.hp===0, respawnCount: Math.min(2,Math.ceil(game.snapshot.respawnRemaining)),
    respawnFlash: respawnAt>0 && now-respawnAt<650,
    fuelStatus: game.motionRef.current.jetpackActive ? 'USING' : game.snapshot.fuel<20 ? 'LOW' : fuelTracker.current.recoveringUntil>now ? 'RECOVERING' : game.snapshot.fuel>=99.5 ? 'FULL' : 'READY',
  };
}
