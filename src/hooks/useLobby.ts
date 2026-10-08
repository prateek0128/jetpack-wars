import { useCallback, useEffect, useState } from 'react';
import { getMyRoom, heartbeat } from '../multiplayer/rooms';
import { subscribeToRoom } from '../multiplayer/lobby';
import type { LobbyRoom } from '../multiplayer/types';

export function useLobby(roomCode: string | undefined) {
  const [room, setRoom] = useState<LobbyRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const refresh = useCallback(async (pulse = false) => {
    try {
      const current = pulse ? await heartbeat() : await getMyRoom();
      if (current && roomCode && current.code !== roomCode.toUpperCase()) throw new Error('Your active room does not match this room code.');
      setRoom(current);
      setError(current ? '' : 'You are not currently a member of this room.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect to this room.'); }
    finally { setLoading(false); }
  }, [roomCode]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!room) return;
    const unsubscribe = subscribeToRoom(room.id, () => void refresh(), status => setConnected(status === 'SUBSCRIBED'));
    const interval = window.setInterval(() => void refresh(true), 12_000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(true); };
    document.addEventListener('visibilitychange', visible);
    return () => { unsubscribe(); window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [room?.id, refresh]);
  return { room, loading, error, connected, refresh };
}
