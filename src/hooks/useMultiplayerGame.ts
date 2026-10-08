import { combatFeedback } from '../presentation/events';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { WeaponId } from '../game/weapons';
import type { GameApi } from '../game/types';
import { getGameSession, getMatchState, getMyRoom, heartbeat, persistPlayerMotion, requestPlayerShot, requestRespawn, switchWeapon as requestSwitch, reloadWeapon, getWeaponState } from '../multiplayer/rooms';
import { parseMovement, playerMovementTopic, publishMovement, MOVEMENT_SEND_INTERVAL_MS, GAME_CHECKPOINT_INTERVAL_MS } from '../multiplayer/movement';
import { requirePlayer, supabase } from '../multiplayer/client';
import type { CombatEvent, GamePlayer, GameSession, MatchSnapshot, MovementPacket } from '../multiplayer/types';
import { RoomRequestError } from '../multiplayer/rooms';

export type GameConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';
type MotionMap = Map<string, MovementPacket>;

function initialPacket(player: GamePlayer): MovementPacket {
  return { x: player.position[0], y: player.position[1], z: player.position[2], yaw: player.rotation_y,
    velocity_y: player.velocity_y, grounded: player.grounded, jetpack_active: player.jetpack_active, sequence: 0, sent_at: 0 };
}

export function useMultiplayerGame(game: GameApi) {
  const [session, setSession] = useState<GameSession | null>(null);
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(null);
  const [matchDetected, setMatchDetected] = useState(() => Boolean(sessionStorage.getItem('jw-match-room')));
  const [lobbyRoomCode, setLobbyRoomCode] = useState<string | null>(null);
  const [connection, setConnection] = useState<GameConnectionStatus>('CONNECTING');
  const [loading, setLoading] = useState(true);
  const [channelRetryVersion, setChannelRetryVersion] = useState(0);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const serverOffsetRef = useRef(0);
  const sessionRef = useRef<GameSession | null>(null);
  const motionMap = useRef<MotionMap>(new Map());
  const sendChannel = useRef<RealtimeChannel | null>(null);
  const canSend = useRef(false);
  const loadInFlight = useRef(false);
  const heartbeatInFlight = useRef(false);
  const lastCheckpointAt = useRef(0);
  const lastPacket = useRef<MovementPacket | null>(null);
  const sequence = useRef(Date.now() * 1000);
  const spawnedSession = useRef('');
  const combatChannel = useRef<RealtimeChannel | null>(null);
  const combatReady = useRef(false);
  const seenEvents = useRef(new Set<string>());
  const respawnTimer = useRef<number | null>(null);
  const channelRetryTimer = useRef<number | null>(null);
  const channelRetryAttempt = useRef(0);

  const weaponQueue = useRef<Promise<void>>(Promise.resolve());

  const applyPlayer = useCallback((player: GamePlayer, tookDamage = false) => {
    setSession((current) => {
      if (!current) return current;
      const updated = { ...current, players: current.players.map((item) => item.player_id === player.player_id ? { ...item, ...player } : item) };
      sessionRef.current = updated;
      return updated;
    });
    if (player.player_id === localPlayerId) {
      game.applyWeaponState(player);
      game.applyAuthoritativeCombat({ hp: player.health, kills: player.kills, deaths: player.deaths, alive: player.is_alive, deadUntil: player.dead_until, tookDamage });
    }
  }, [game.applyAuthoritativeCombat, game.applyWeaponState, localPlayerId]);

  const applyMatch = useCallback((match: MatchSnapshot) => {
    const offset = Date.parse(match.server_now) - Date.now();
    serverOffsetRef.current = offset;
    setServerOffsetMs(offset);
    setSession((current) => {
      if (!current) return current;
      const updated = { ...current, match, players: current.players.map(player => {
        const score = match.scores.find(item => item.player_id === player.player_id);
        return score ? { ...player, kills: score.kills, deaths: score.deaths } : player;
      }) };
      sessionRef.current = updated;
      return updated;
    });
  }, []);

  const handleCombatEvent = useCallback((event: CombatEvent) => {
    if (!event?.event_id || seenEvents.current.has(event.event_id)) return;
    seenEvents.current.add(event.event_id);
    combatFeedback(event);
    if (seenEvents.current.size > 500) seenEvents.current.clear();
    if (event.type === 'shot_fired' && event.shooter_id !== localPlayerId && event.origin && event.end) {
      window.dispatchEvent(new CustomEvent('game-remote-shot', { detail: event }));
    }
    if (event.type === 'player_damaged' && event.shooter_id === localPlayerId) game.confirmHit();
    if (event.match) applyMatch(event.match);
    if (event.player) {
      applyPlayer(event.player, event.type === 'player_damaged' && event.target_id === localPlayerId);
      if (event.type === 'player_respawned' && event.player.player_id === localPlayerId) {
        game.setSpawn(event.player.position, event.player.rotation_y);
        game.applyWeaponState(event.player);
        game.applyAuthoritativeCombat({ hp: event.player.health, kills: event.player.kills, deaths: event.player.deaths, alive: true, deadUntil: null });
      }
    }
    if (event.shooter) applyPlayer(event.shooter);
    if (event.victim) applyPlayer(event.victim);
  }, [applyMatch, applyPlayer, game.applyAuthoritativeCombat, game.confirmHit, game.setSpawn, localPlayerId]);

  const acceptSession = useCallback(async (next: GameSession) => {
    const user = await requirePlayer();
    if (!user) throw new Error('No authenticated player session.');
    const lobbyPlayerId = sessionStorage.getItem('jw-lobby-player-id');
    const matchingPlayers = next.players.filter((player) => player.player_id === user.id);
    if (next.player_id !== user.id || (lobbyPlayerId && lobbyPlayerId !== user.id) || matchingPlayers.length !== 1) {
      const identity = {
        authUserId: user.id,
        lobbyPlayerId,
        roomSessionPlayerId: next.player_id,
        gamePlayerIds: next.players.map((player) => player.player_id),
      };
      if (import.meta.env.DEV) console.error('[Jetpack Wars] Multiplayer identity mismatch', identity);
      throw new Error('Your authenticated pilot does not match the active game session.');
    }
    const local = matchingPlayers[0];
    const offset = Date.parse(next.match.server_now) - Date.now();
    serverOffsetRef.current = offset;
    setServerOffsetMs(offset);
    game.applyAuthoritativeCombat({ hp: local.health, kills: local.kills, deaths: local.deaths, alive: local.is_alive, deadUntil: local.dead_until });
    const key = `${next.game_id}:${user.id}:${next.match.countdown_ends_at ?? next.match.started_at ?? 'match'}`;
    if (spawnedSession.current !== key) {
      game.setSpawn(local.position, local.rotation_y);
      spawnedSession.current = key;
    }
    game.applyAuthoritativeCombat({ hp: local.health, kills: local.kills, deaths: local.deaths, alive: local.is_alive, deadUntil: local.dead_until });
    game.applyWeaponState(local);
    for (const player of next.players) {
      if (player.player_id !== user.id && !motionMap.current.has(player.player_id)) motionMap.current.set(player.player_id, initialPacket(player));
    }
    sessionRef.current = next;
    setLocalPlayerId(user.id);
    setMatchDetected(true);
    sessionStorage.setItem('jw-match-room', next.room_code);
    setSession(next);
  }, [game.applyAuthoritativeCombat, game.applyWeaponState, game.setSpawn]);

  const loadSession = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setConnection((current) => current === 'CONNECTED' ? current : 'RECONNECTING');
    try {
      await requirePlayer();
      // An active match can be recovered through the authenticated member row even
      // if the lobby heartbeat already marked it stale while this tab was away.
      const room = await getMyRoom();
      if (room?.match_state === 'LOBBY') {
        sessionRef.current = null; setSession(null); setMatchDetected(false);
        sessionStorage.removeItem('jw-match-room'); setLobbyRoomCode(room.code); setConnection('DISCONNECTED');
        return;
      }
      if (!room || !['STARTING', 'IN_MATCH'].includes(room.status)) {
        let recovered: GameSession;
        try { recovered = await getGameSession(); }
        catch (error) {
          if (room || !(error instanceof RoomRequestError && error.noActiveMatch)) throw error;
          sessionRef.current = null; setSession(null); setMatchDetected(false);
          sessionStorage.removeItem('jw-match-room'); setConnection('DISCONNECTED'); return;
        }
        await acceptSession(recovered);
        return;
      }
      setMatchDetected(true);
      const gameSession = await getGameSession();
      await acceptSession(gameSession);
    } catch {
      setConnection(sessionRef.current || matchDetected ? 'RECONNECTING' : 'DISCONNECTED');
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }, [acceptSession, matchDetected]);

  useEffect(() => { void loadSession(); }, [loadSession]);

  // A remote host can start the next round without remounting this client.
  // Recover its reset health, scores, loadout and spawn from the existing RPC.
  const observedRound = useRef<string | null>(null);
  const roundKey = session?.match.countdown_ends_at ?? session?.match.started_at ?? null;
  useEffect(() => {
    const previous = observedRound.current;
    observedRound.current = roundKey;
    if (previous && roundKey && previous !== roundKey) void loadSession();
  }, [roundKey, loadSession]);

  const rosterKey = session?.players.map((player) => player.player_id).sort().join(',') ?? '';
  useEffect(() => {
    const client = supabase;
    if (!session || !localPlayerId || !client) return;
    if (session.player_id !== localPlayerId) {
      if (import.meta.env.DEV) console.error('[Jetpack Wars] Refusing to subscribe with mismatched local player identity', {
        authUserId: localPlayerId,
        sessionPlayerId: session.player_id,
      });
      setConnection('DISCONNECTED');
      return;
    }
    let live = true;
    setConnection('RECONNECTING');
    const channels: RealtimeChannel[] = [];
    const statuses = new Map<string, boolean>();
    const retrySubscription = () => {
      if (channelRetryTimer.current !== null) return;
      const delay = Math.min(30_000, 1_000 * (2 ** channelRetryAttempt.current++));
      channelRetryTimer.current = window.setTimeout(() => {
        channelRetryTimer.current = null;
        if (live) setChannelRetryVersion((version) => version + 1);
      }, delay);
    };
    const refreshTransport = () => {
      if (!live) return;
      const ready = topicIds.every((topicId) => statuses.get(topicId) === true) && statuses.get('combat') === true;
      if (ready) {
        if (channelRetryTimer.current !== null) window.clearTimeout(channelRetryTimer.current);
        channelRetryTimer.current = null;
        channelRetryAttempt.current = 0;
        setConnection('CONNECTED');
      } else setConnection('RECONNECTING');
    };
    const remoteIds = session.players.filter((player) => player.player_id !== localPlayerId).map((player) => player.player_id);
    const topicIds = [localPlayerId, ...remoteIds];
    const updateStatus = (id: string, status: string) => {
      if (!live) return;
      statuses.set(id, status === 'SUBSCRIBED');
      if (status === 'SUBSCRIBED') {
        if (id === localPlayerId) canSend.current = true;
      } else {
        if (id === localPlayerId) canSend.current = false;
        if (live && import.meta.env.DEV) console.warn('[Jetpack Wars] Realtime movement channel status', { roomId: session.game_id, playerId: id, status });
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') retrySubscription();
      }
      refreshTransport();
    };

    for (const playerId of topicIds) {
      const channel = client.channel(playerMovementTopic(session.game_id, playerId), {
        config: { private: true, broadcast: { ack: false } },
      });
      if (playerId !== localPlayerId) {
        channel.on('broadcast', { event: 'movement' }, (message) => {
          const packet = parseMovement(message.payload);
          if (!packet) return;
          const previous = motionMap.current.get(playerId);
          if (!previous || packet.sequence > previous.sequence) motionMap.current.set(playerId, packet);
        });
      }
      channels.push(channel);
      channel.subscribe((status) => updateStatus(playerId, status));
      if (playerId === localPlayerId) sendChannel.current = channel;
    }
    const combat = client.channel(`game:${session.game_id}:combat`, { config: { private: true, broadcast: { ack: false } } });
    combat.on('broadcast', { event: 'combat' }, (message) => handleCombatEvent(message.payload as CombatEvent));
    combat.subscribe((status) => {
      if (!live) return;
      combatReady.current = status === 'SUBSCRIBED';
      statuses.set('combat', combatReady.current);
      if (!combatReady.current) {
        if (import.meta.env.DEV) console.warn('[Jetpack Wars] Realtime combat channel status', { roomId: session.game_id, status });
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') retrySubscription();
      }
      refreshTransport();
    });
    combatChannel.current = combat;
    channels.push(combat);
    return () => {
      live = false;
      if (channelRetryTimer.current !== null) window.clearTimeout(channelRetryTimer.current);
      channelRetryTimer.current = null;
      canSend.current = false;
      sendChannel.current = null;
      combatChannel.current = null;
      combatReady.current = false;
      for (const channel of channels) void client.removeChannel(channel);
    };
  }, [session?.game_id, session?.player_id, localPlayerId, rosterKey, handleCombatEvent, channelRetryVersion]);

  const fireAuthoritative = useCallback(async (weapon: WeaponId, direction: [number, number, number]) => {
    if (!sessionRef.current || sessionRef.current.match.match_state !== 'ACTIVE' || !combatReady.current) return;
    try {
      await weaponQueue.current;
      const result = await requestPlayerShot(weapon, direction);
      if (result.player) applyPlayer(result.player);
      for (const event of result.events ?? []) handleCombatEvent(event);
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[Jetpack Wars] Shot request failed', error);
    }
  }, [handleCombatEvent, applyPlayer]);

  const switchAuthoritative = useCallback((weapon: WeaponId) => {
    if (sessionRef.current?.match.match_state !== 'ACTIVE' || !combatReady.current || game.snapshot.hp <= 0) return;
    game.switchWeapon(weapon);
    weaponQueue.current = weaponQueue.current.then(async () => { applyPlayer(await requestSwitch(weapon)); }).catch(async (error) => {
      if (import.meta.env.DEV) console.warn('[Jetpack Wars] Weapon switch failed', error);
      try { applyPlayer(await getWeaponState()); } catch { /* reconnect recovers state */ }
    });
  }, [game.switchWeapon, game.snapshot.hp, applyPlayer]);
  const reloadAuthoritative = useCallback(() => {
    if (sessionRef.current?.match.match_state !== 'ACTIVE' || !combatReady.current) return;
    weaponQueue.current = weaponQueue.current.then(async () => { applyPlayer(await reloadWeapon()); }).catch((error) => {
      if (import.meta.env.DEV) console.warn('[Jetpack Wars] Reload failed', error);
    });
  }, [applyPlayer]);
  useEffect(() => {
    if (!session || session.match.match_state !== 'ACTIVE') return;
    let busy = false;
    const timer = window.setInterval(async () => {
      if (busy) return; busy = true;
      try { await weaponQueue.current; game.applyWeaponState(await getWeaponState()); } catch { /* normal match end or reconnect */ }
      finally { busy = false; }
    }, 500);
    return () => window.clearInterval(timer);
  }, [session?.game_id, session?.match.match_state, game.applyWeaponState]);

  const localPlayer = session?.players.find((player) => player.player_id === localPlayerId);
  useEffect(() => {
    if (respawnTimer.current !== null) window.clearTimeout(respawnTimer.current);
    if (!localPlayer || !session || session.match.match_state !== 'ACTIVE' || localPlayer.is_alive || !localPlayer.dead_until) return;
    let live = true;
    const waitMs = Math.max(50, Date.parse(localPlayer.dead_until) - (Date.now() + serverOffsetRef.current) + 30);
    respawnTimer.current = window.setTimeout(async () => {
      try {
        const result = await requestRespawn();
        if (!live) return;
        for (const event of result.events ?? []) handleCombatEvent(event);
        if (!result.accepted && result.retry_after_ms !== undefined) {
          respawnTimer.current = window.setTimeout(async () => {
            try {
              const retry = await requestRespawn();
              if (live) for (const event of retry.events ?? []) handleCombatEvent(event);
            } catch { if (live) void loadSession(); }
          }, Math.max(80, result.retry_after_ms + 30));
        }
      } catch { if (live) void loadSession(); }
    }, waitMs);
    return () => { live = false; if (respawnTimer.current !== null) window.clearTimeout(respawnTimer.current); };
  }, [localPlayer?.is_alive, localPlayer?.dead_until, session?.game_id, session?.match.match_state, handleCombatEvent, loadSession]);

  useEffect(() => {
    if (!session) return;
    let inFlight = false;
    const refreshMatch = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const match = await getMatchState();
        applyMatch(match);
      } catch { /* The session may have returned to its lobby while this tab was closing. */ }
      finally { inFlight = false; }
    };
    const timer = window.setInterval(() => void refreshMatch(), 1500);
    void refreshMatch();
    return () => window.clearInterval(timer);
  }, [session?.game_id, applyMatch]);

  useEffect(() => {
    if (!session) return;
    const publishTimer = window.setInterval(() => {
      const channel = sendChannel.current;
      if (!channel || !canSend.current || sessionRef.current?.match.match_state !== 'ACTIVE') return;
      const motion = game.motionRef.current;
      const packet: MovementPacket = {
        x: motion.x, y: motion.y, z: motion.z, yaw: motion.yaw,
        velocity_y: motion.velocityY, grounded: motion.grounded,
        jetpack_active: motion.jetpackActive, sequence: ++sequence.current, sent_at: Date.now(),
      };
      const prev = lastPacket.current;
      const changed = !prev || Math.abs(packet.x - prev.x) > 0.018 || Math.abs(packet.y - prev.y) > 0.018
        || Math.abs(packet.z - prev.z) > 0.018 || Math.abs(packet.yaw - prev.yaw) > 0.015
        || packet.grounded !== prev.grounded || packet.jetpack_active !== prev.jetpack_active;
      if (changed || packet.sent_at - (prev?.sent_at ?? 0) >= 250) {
        lastPacket.current = packet;
        void publishMovement(channel, packet);
      }
    }, MOVEMENT_SEND_INTERVAL_MS);

    let checkpointInFlight = false;
    const checkpointTimer = window.setInterval(() => {
      if (checkpointInFlight) return;
      if (sessionRef.current?.match.match_state !== 'ACTIVE') return;
      if (document.visibilityState !== 'visible' || Date.now() - lastCheckpointAt.current < GAME_CHECKPOINT_INTERVAL_MS) return;
      const motion = game.motionRef.current;
      const packet: MovementPacket = {
        x: motion.x, y: motion.y, z: motion.z, yaw: motion.yaw,
        velocity_y: motion.velocityY, grounded: motion.grounded,
        jetpack_active: motion.jetpackActive, sequence: sequence.current, sent_at: Date.now(),
      };
      lastCheckpointAt.current = packet.sent_at;
      checkpointInFlight = true;
      void persistPlayerMotion(packet).catch(() => setConnection((state) => state === 'CONNECTED' ? 'RECONNECTING' : state))
        .finally(() => { checkpointInFlight = false; });
    }, GAME_CHECKPOINT_INTERVAL_MS);

    const heartbeatTimer = window.setInterval(async () => {
      if (heartbeatInFlight.current || document.visibilityState !== 'visible') return;
      heartbeatInFlight.current = true;
      try {
        const room = await heartbeat();
        if (room) {
          const activeIds = new Set(room.players.filter((player) => player.is_active).map((player) => player.player_id));
          setSession((current) => {
            if (!current) return current;
            const updated = { ...current, players: current.players.map((player) => ({ ...player, is_active: activeIds.has(player.player_id) })) };
            sessionRef.current = updated;
            return updated;
          });
        } else {
          await loadSession();
        }
      } catch {
        if (sessionRef.current) setConnection('RECONNECTING');
      } finally { heartbeatInFlight.current = false; }
    }, 12_000);

    const onVisible = () => { if (document.visibilityState === 'visible') void loadSession(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(publishTimer); window.clearInterval(checkpointTimer); window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session?.game_id, session?.player_id, game.motionRef, loadSession]);

  return { session, localPlayerId, matchDetected, connection, loading, motionMap, fireAuthoritative, switchAuthoritative, reloadAuthoritative, serverOffsetMs, lobbyRoomCode, refreshSession: loadSession };
}
