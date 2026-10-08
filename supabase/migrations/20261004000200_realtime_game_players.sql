create table if not exists public.game_players (
  game_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  spawn_x double precision not null,
  spawn_y double precision not null,
  spawn_z double precision not null,
  position_x double precision not null,
  position_y double precision not null,
  position_z double precision not null,
  rotation_y double precision not null default 0,
  velocity_y double precision not null default 0,
  grounded boolean not null default false,
  jetpack_active boolean not null default false,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create index if not exists game_players_seen_idx on public.game_players(game_id, last_seen_at);
alter table public.game_players enable row level security;
revoke all on public.game_players from anon, authenticated;
grant select on public.game_players to authenticated;

create policy "Active game members can read their game players"
  on public.game_players for select to authenticated
  using ((select private.is_room_member(game_id)));

create or replace function private.can_read_game_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_game_id uuid; v_topic_player uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null or split_part(p_topic, ':', 1) <> 'game' or split_part(p_topic, ':', 3) <> 'player' then return false; end if;
  begin
    v_game_id := split_part(p_topic, ':', 2)::uuid;
    v_topic_player := split_part(p_topic, ':', 4)::uuid;
  exception when invalid_text_representation then return false;
  end;
  return exists (
    select 1 from public.rooms r
    join public.room_players member on member.room_id = r.id and member.player_id = v_uid and member.is_active
    join public.game_players gp on gp.game_id = r.id and gp.player_id = v_topic_player
    where r.id = v_game_id and r.status in ('STARTING', 'IN_MATCH')
  );
end;
$$;

create or replace function private.can_write_game_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_game_id uuid; v_topic_player uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null or split_part(p_topic, ':', 1) <> 'game' or split_part(p_topic, ':', 3) <> 'player' then return false; end if;
  begin
    v_game_id := split_part(p_topic, ':', 2)::uuid;
    v_topic_player := split_part(p_topic, ':', 4)::uuid;
  exception when invalid_text_representation then return false;
  end;
  return v_topic_player = v_uid and exists (
    select 1 from public.rooms r
    join public.room_players member on member.room_id = r.id and member.player_id = v_uid and member.is_active
    join public.game_players gp on gp.game_id = r.id and gp.player_id = v_uid
    where r.id = v_game_id and r.status in ('STARTING', 'IN_MATCH')
  );
end;
$$;

revoke all on function private.can_read_game_topic(text), private.can_write_game_topic(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_read_game_topic(text), private.can_write_game_topic(text) to authenticated;

drop policy if exists "Active game members can receive player movement" on realtime.messages;
create policy "Active game members can receive player movement"
  on realtime.messages for select to authenticated
  using (extension = 'broadcast' and (select private.can_read_game_topic(realtime.topic())));

drop policy if exists "Players can only broadcast on their own game topic" on realtime.messages;
create policy "Players can only broadcast on their own game topic"
  on realtime.messages for insert to authenticated
  with check (extension = 'broadcast' and (select private.can_write_game_topic(realtime.topic())));

create or replace function public.get_game_session()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_game_id uuid; v_room_code text; v_status text; v_result jsonb;
begin
  if v_uid is null then raise exception 'Sign in before requesting a game session'; end if;

  select rp.room_id into v_game_id
  from public.room_players rp
  join public.rooms r on r.id = rp.room_id
  where rp.player_id = v_uid and r.status in ('STARTING', 'IN_MATCH')
  order by rp.joined_at desc limit 1;
  if v_game_id is null then raise exception 'No active match session'; end if;

  -- Restore a timed-out member when the same authenticated user returns.
  if not exists (select 1 from public.room_players rp where rp.player_id = v_uid and rp.room_id = v_game_id and rp.is_active) then
    if exists (select 1 from public.room_players rp where rp.player_id = v_uid and rp.is_active and rp.room_id <> v_game_id) then
      raise exception 'This player is already active in another room';
    end if;
    update public.room_players set is_active = true, is_ready = true, last_seen_at = now()
      where player_id = v_uid and room_id = v_game_id;
  end if;

  select r.code, r.status into v_room_code, v_status from public.rooms r where r.id = v_game_id for update;
  if v_status not in ('STARTING', 'IN_MATCH') then raise exception 'The game is no longer active'; end if;

  with spawn_slots(slot, x, y, z) as (
    values (1,-4.0,0.0,5.0),(2,4.0,0.0,-5.0),(3,-4.0,0.0,-5.0),(4,4.0,0.0,5.0),
      (5,-12.0,2.98,0.0),(6,12.0,2.98,0.0),(7,0.0,4.6,-13.0),(8,0.0,2.425,13.0)
  ), ordered_members as (
    select rp.player_id, rp.display_name,
      row_number() over (order by rp.joined_at, rp.player_id) as slot
    from public.room_players rp where rp.room_id = v_game_id and rp.is_active
  )
  insert into public.game_players(game_id, player_id, display_name, spawn_x, spawn_y, spawn_z, position_x, position_y, position_z, rotation_y, grounded, last_seen_at)
  select v_game_id, member.player_id, member.display_name, slot.x, slot.y, slot.z, slot.x, slot.y, slot.z,
    atan2(slot.x, slot.z), true, now()
  from ordered_members member join spawn_slots slot on slot.slot = member.slot
  on conflict (game_id, player_id) do update set display_name = excluded.display_name;

  select jsonb_build_object(
    'game_id', v_game_id, 'room_code', v_room_code, 'status', v_status, 'player_id', v_uid,
    'players', coalesce(jsonb_agg(jsonb_build_object(
      'player_id', gp.player_id, 'display_name', gp.display_name,
      'spawn_position', jsonb_build_array(gp.spawn_x, gp.spawn_y, gp.spawn_z),
      'position', jsonb_build_array(gp.position_x, gp.position_y, gp.position_z),
      'rotation_y', gp.rotation_y, 'velocity_y', gp.velocity_y,
      'grounded', gp.grounded, 'jetpack_active', gp.jetpack_active,
      'last_seen_at', gp.last_seen_at, 'is_active', coalesce(rp.is_active, false)
    ) order by coalesce(rp.joined_at, gp.updated_at), gp.player_id), '[]'::jsonb)
  ) into v_result
  from public.game_players gp
  left join public.room_players rp on rp.room_id = gp.game_id and rp.player_id = gp.player_id
  where gp.game_id = v_game_id;
  return v_result;
end;
$$;

create or replace function public.persist_game_player_state(
  p_x double precision, p_y double precision, p_z double precision,
  p_rotation_y double precision, p_velocity_y double precision,
  p_grounded boolean, p_jetpack_active boolean
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_game_id uuid; v_rows integer;
begin
  if v_uid is null then raise exception 'Sign in before updating game state'; end if;
  if p_x not between -20 and 20 or p_z not between -20 and 20 or p_y not between -0.5 and 30
      or p_rotation_y not between -100000 and 100000 or p_velocity_y not between -20 and 20
      or p_grounded is null or p_jetpack_active is null then
    raise exception 'Player state is outside allowed bounds';
  end if;
  select rp.room_id into v_game_id from public.room_players rp
    join public.rooms r on r.id = rp.room_id
    where rp.player_id = v_uid and rp.is_active and r.status in ('STARTING', 'IN_MATCH')
    order by rp.joined_at desc limit 1;
  if v_game_id is null then raise exception 'No active game membership'; end if;
  update public.game_players gp set position_x = p_x, position_y = p_y, position_z = p_z,
    rotation_y = p_rotation_y, velocity_y = p_velocity_y, grounded = p_grounded,
    jetpack_active = p_jetpack_active, last_seen_at = now(), updated_at = now()
  where gp.game_id = v_game_id and gp.player_id = v_uid
    and gp.updated_at < now() - interval '900 milliseconds';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.get_game_session(), public.persist_game_player_state(double precision,double precision,double precision,double precision,double precision,boolean,boolean) from public, anon;
grant execute on function public.get_game_session(), public.persist_game_player_state(double precision,double precision,double precision,double precision,double precision,boolean,boolean) to authenticated;

comment on table public.game_players is 'Durable Phase 2B player spawn and reconnect checkpoint; high-rate movement uses private Realtime Broadcast.';
