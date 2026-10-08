import { supabase } from './client';

export function subscribeToRoom(roomId: string, onChange: () => void, onStatus: (status: string) => void = () => undefined) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client.channel(`room:${roomId}`, { config: { private: true } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, onChange)
    .subscribe(status => onStatus(status));
  return () => { void client.removeChannel(channel); };
}
