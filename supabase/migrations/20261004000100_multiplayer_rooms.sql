create schema if not exists private;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{5}$'),
  host_player_id uuid not null,
  status text not null default 'LOBBY' check (status in ('LOBBY', 'STARTING', 'IN_MATCH')),
  max_players integer not null default 8 check (max_players between 2 and 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  is_ready boolean not null default false,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (room_id, player_id)
);

create index if not exists room_players_room_active_idx on public.room_players(room_id, is_active, joined_at, player_id);
create index if not exists room_players_seen_idx on public.room_players(last_seen_at) where is_active;
create unique index if not exists room_players_one_active_room_per_player on public.room_players(player_id) where is_active;

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
revoke all on public.rooms, public.room_players from anon, authenticated;
grant select on public.rooms, public.room_players to authenticated;

create or replace function private.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.room_players rp
    where rp.room_id = p_room_id and rp.player_id = (select auth.uid()) and rp.is_active)
$$;

revoke all on function private.is_room_member(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_room_member(uuid) to authenticated;

create policy "Room members can read their room"
  on public.rooms for select to authenticated
  using ((select private.is_room_member(id)));
create policy "Room members can read their lobby roster"
  on public.room_players for select to authenticated
  using ((select private.is_room_member(room_id)));

-- Realtime is configured as private in each client channel; only active members
-- of the UUID encoded by room:<uuid> can join and receive channel messages.
drop policy if exists "Room members can receive private lobby changes" on realtime.messages;
create policy "Room members can receive private lobby changes"
  on realtime.messages for select to authenticated
  using (
    (select private.is_room_member(
      case when split_part(realtime.topic(), ':', 1) = 'room'
        then split_part(realtime.topic(), ':', 2)::uuid else null end
    ))
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_players') then
    alter publication supabase_realtime add table public.room_players;
  end if;
end;
$$;

create or replace function private.lobby_snapshot(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'code', r.code, 'host_player_id', r.host_player_id,
    'status', r.status, 'max_players', r.max_players,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'player_id', rp.player_id, 'display_name', rp.display_name,
      'is_ready', rp.is_ready, 'joined_at', rp.joined_at,
      'last_seen_at', rp.last_seen_at, 'is_active', rp.is_active
    ) order by rp.joined_at, rp.player_id)
      from public.room_players rp where rp.room_id = r.id and rp.is_active), '[]'::jsonb)
  ) from public.rooms r where r.id = p_room_id
$$;

create or replace function private.current_room_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select rp.room_id from public.room_players rp
  where rp.player_id = (select auth.uid()) and rp.is_active
  order by rp.joined_at desc limit 1
$$;

create or replace function private.expire_stale_players()
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room record; v_new_host uuid;
begin
  update public.room_players rp set is_active = false, is_ready = false
  where rp.is_active and rp.last_seen_at < now() - interval '35 seconds';

  for v_room in select r.id, r.host_player_id from public.rooms r
    where r.status = 'LOBBY' and not exists (
      select 1 from public.room_players rp where rp.room_id = r.id
        and rp.player_id = r.host_player_id and rp.is_active
    )
  loop
    select rp.player_id into v_new_host from public.room_players rp
      where rp.room_id = v_room.id and rp.is_active
      order by rp.joined_at, rp.player_id limit 1;
    if v_new_host is not null then
      update public.rooms set host_player_id = v_new_host, updated_at = now() where id = v_room.id;
    end if;
  end loop;
  update public.rooms r set updated_at = now()
    where r.status = 'LOBBY' and exists (select 1 from public.room_players rp
      where rp.room_id = r.id and not rp.is_active and rp.last_seen_at >= now() - interval '36 seconds');
end;
$$;

create or replace function public.create_room(p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room_id uuid; v_code text; v_token uuid; v_attempt integer := 0;
begin
  if v_uid is null then raise exception 'Sign in before creating a room'; end if;
  if char_length(btrim(p_display_name)) not between 1 and 24 then raise exception 'Display name must be 1–24 characters'; end if;
  perform private.expire_stale_players();
  select rp.room_id into v_room_id from public.room_players rp where rp.player_id = v_uid and rp.is_active limit 1;
  if v_room_id is not null then return private.lobby_snapshot(v_room_id); end if;
  loop
    v_token := gen_random_uuid();
    v_code := '';
    for i in 0..4 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (pg_catalog.get_byte(pg_catalog.uuid_send(v_token), i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
    v_attempt := v_attempt + 1;
    if v_attempt > 12 then raise exception 'Could not allocate a room code'; end if;
  end loop;
  insert into public.rooms(code, host_player_id) values (v_code, v_uid) returning id into v_room_id;
  insert into public.room_players(room_id, player_id, display_name) values (v_room_id, v_uid, btrim(p_display_name));
  return private.lobby_snapshot(v_room_id);
end;
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room public.rooms%rowtype; v_room_id uuid;
begin
  if v_uid is null then raise exception 'Sign in before joining a room'; end if;
  if char_length(btrim(p_display_name)) not between 1 and 24 then raise exception 'Display name must be 1–24 characters'; end if;
  perform private.expire_stale_players();
  select rp.room_id into v_room_id from public.room_players rp where rp.player_id = v_uid and rp.is_active limit 1;
  if v_room_id is not null then
    if exists(select 1 from public.rooms r where r.id = v_room_id and r.code = upper(btrim(p_code))) then
      update public.room_players set last_seen_at = now(), display_name = btrim(p_display_name) where room_id = v_room_id and player_id = v_uid;
      return private.lobby_snapshot(v_room_id);
    end if;
    raise exception 'Leave your current room before joining another';
  end if;
  select * into v_room from public.rooms r where r.code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Room code not found'; end if;
  if v_room.status <> 'LOBBY' then raise exception 'This room is no longer accepting players'; end if;
  if (select count(*) from public.room_players rp where rp.room_id = v_room.id and rp.is_active) >= v_room.max_players then raise exception 'This room is full'; end if;
  insert into public.room_players(room_id, player_id, display_name, is_active, last_seen_at)
    values(v_room.id, v_uid, btrim(p_display_name), true, now())
    on conflict(room_id, player_id) do update set display_name = excluded.display_name,
      is_active = true, is_ready = false, last_seen_at = now();
  update public.rooms set updated_at = now() where id = v_room.id;
  return private.lobby_snapshot(v_room.id);
end;
$$;

create or replace function public.set_ready(p_is_ready boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room_id uuid := private.current_room_id();
begin
  if v_uid is null or v_room_id is null then raise exception 'No active room membership'; end if;
  update public.room_players set is_ready = p_is_ready, last_seen_at = now() where room_id = v_room_id and player_id = v_uid and is_active;
  update public.rooms set updated_at = now() where id = v_room_id;
  return private.lobby_snapshot(v_room_id);
end;
$$;

create or replace function public.leave_room()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room_id uuid := private.current_room_id(); v_new_host uuid;
begin
  if v_uid is null or v_room_id is null then return false; end if;
  delete from public.room_players where room_id = v_room_id and player_id = v_uid;
  if exists(select 1 from public.rooms r where r.id = v_room_id and r.host_player_id = v_uid and r.status = 'LOBBY') then
    select rp.player_id into v_new_host from public.room_players rp where rp.room_id = v_room_id and rp.is_active order by rp.joined_at, rp.player_id limit 1;
    if v_new_host is not null then update public.rooms set host_player_id = v_new_host, updated_at = now() where id = v_room_id;
    else delete from public.rooms where id = v_room_id; end if;
  else update public.rooms set updated_at = now() where id = v_room_id;
  end if;
  return true;
end;
$$;

create or replace function public.heartbeat()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room_id uuid;
begin
  if v_uid is null then raise exception 'Sign in before sending a heartbeat'; end if;
  perform private.expire_stale_players();
  update public.room_players rp set is_active = true, is_ready = false, last_seen_at = now()
    where rp.player_id = v_uid and not rp.is_active
      and not exists (select 1 from public.room_players current where current.player_id = rp.player_id and current.is_active)
      and exists (
      select 1 from public.rooms r where r.id = rp.room_id and r.status = 'LOBBY'
        and (select count(*) from public.room_players live where live.room_id = rp.room_id and live.is_active) < r.max_players
    );
  select rp.room_id into v_room_id from public.room_players rp where rp.player_id = v_uid and rp.is_active order by rp.joined_at desc limit 1;
  if v_room_id is null then return null; end if;
  update public.room_players set last_seen_at = now() where room_id = v_room_id and player_id = v_uid;
  return private.lobby_snapshot(v_room_id);
end;
$$;

create or replace function public.start_match()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room_id uuid := private.current_room_id();
begin
  if v_uid is null or v_room_id is null then raise exception 'No active room membership'; end if;
  perform private.expire_stale_players();
  update public.rooms r set status = 'STARTING', updated_at = now()
    where r.id = v_room_id and r.host_player_id = v_uid and r.status = 'LOBBY'
      and (select count(*) from public.room_players rp where rp.room_id = r.id and rp.is_active) >= 2
      and not exists(select 1 from public.room_players rp where rp.room_id = r.id and rp.is_active and not rp.is_ready);
  if not found then raise exception 'Only the host can start once 2 or more active players are all ready'; end if;
  return private.lobby_snapshot(v_room_id);
end;
$$;

create or replace function public.get_my_room()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room_id uuid;
begin
  if v_uid is null then raise exception 'Sign in before requesting a room'; end if;
  perform private.expire_stale_players();
  update public.room_players rp set is_active = true, is_ready = false, last_seen_at = now()
    where rp.player_id = v_uid and not rp.is_active
      and not exists (select 1 from public.room_players current where current.player_id = rp.player_id and current.is_active)
      and exists (
      select 1 from public.rooms r where r.id = rp.room_id and r.status = 'LOBBY'
        and (select count(*) from public.room_players live where live.room_id = rp.room_id and live.is_active) < r.max_players
    );
  select rp.room_id into v_room_id from public.room_players rp where rp.player_id = v_uid and rp.is_active order by rp.joined_at desc limit 1;
  if v_room_id is null then return null; end if;
  update public.room_players set last_seen_at = now() where room_id = v_room_id and player_id = v_uid;
  return private.lobby_snapshot(v_room_id);
end;
$$;

revoke all on function public.create_room(text), public.join_room(text,text), public.set_ready(boolean), public.leave_room(), public.heartbeat(), public.start_match(), public.get_my_room() from public, anon;
grant execute on function public.create_room(text), public.join_room(text,text), public.set_ready(boolean), public.leave_room(), public.heartbeat(), public.start_match(), public.get_my_room() to authenticated;

comment on function public.start_match() is 'Phase 2A only changes lobby state. Phase 2B will attach networked gameplay here.';
