-- Internal lobby helpers are invoked only by SECURITY DEFINER room RPCs.
-- Policy helpers retain authenticated execution for RLS/Realtime authorization.
revoke all on function private.lobby_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.current_room_id() from public, anon, authenticated;
revoke all on function private.expire_stale_players() from public, anon, authenticated;
