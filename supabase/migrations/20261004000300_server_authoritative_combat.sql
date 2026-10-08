alter table public.game_players
  add column if not exists health smallint not null default 100 check (health between 0 and 100),
  add column if not exists kills integer not null default 0 check (kills >= 0),
  add column if not exists deaths integer not null default 0 check (deaths >= 0),
  add column if not exists is_alive boolean not null default true,
  add column if not exists dead_until timestamptz,
  add column if not exists last_fire_at timestamptz;

create or replace function private.can_read_combat_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_game_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null or split_part(p_topic, ':', 1) <> 'game' or split_part(p_topic, ':', 3) <> 'combat' then return false; end if;
  begin v_game_id := split_part(p_topic, ':', 2)::uuid;
  exception when invalid_text_representation then return false; end;
  return exists (
    select 1 from public.rooms r
    join public.room_players member on member.room_id = r.id and member.player_id = v_uid and member.is_active
    where r.id = v_game_id and r.status in ('STARTING', 'IN_MATCH')
      and member.last_seen_at > now() - interval '35 seconds'
  );
end;
$$;

revoke all on function private.can_read_combat_topic(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_read_combat_topic(text) to authenticated;

create policy "Active game members can receive authoritative combat events"
  on realtime.messages for select to authenticated
  using (extension = 'broadcast' and (select private.can_read_combat_topic(realtime.topic())));

create or replace function private.combat_player_snapshot(p_game_id uuid, p_player_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'player_id', gp.player_id, 'display_name', gp.display_name,
    'health', gp.health, 'kills', gp.kills, 'deaths', gp.deaths,
    'is_alive', gp.is_alive, 'dead_until', gp.dead_until,
    'position', jsonb_build_array(gp.position_x, gp.position_y, gp.position_z),
    'rotation_y', gp.rotation_y, 'velocity_y', gp.velocity_y,
    'grounded', gp.grounded, 'jetpack_active', gp.jetpack_active,
    'last_seen_at', gp.last_seen_at, 'is_active', coalesce(rp.is_active, false)
  )
  from public.game_players gp
  left join public.room_players rp on rp.room_id = gp.game_id and rp.player_id = gp.player_id
  where gp.game_id = p_game_id and gp.player_id = p_player_id
$$;

create or replace function private.publish_combat_event(p_game_id uuid, p_event jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(p_event, 'combat', 'game:' || p_game_id::text || ':combat', true);
end;
$$;

create or replace function private.respawn_game_player(p_game_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_player record; v_event jsonb;
begin
  update public.game_players gp set
    position_x = gp.spawn_x, position_y = gp.spawn_y, position_z = gp.spawn_z,
    rotation_y = atan2(gp.spawn_x, gp.spawn_z), velocity_y = 0,
    grounded = true, jetpack_active = false, health = 100,
    is_alive = true, dead_until = null, last_fire_at = null,
    last_seen_at = now(), updated_at = now()
  from public.rooms r join public.room_players member on member.room_id = r.id
  where gp.game_id = p_game_id and gp.player_id = p_player_id
    and r.id = p_game_id and r.status in ('STARTING', 'IN_MATCH')
    and member.player_id = p_player_id and member.is_active
    and not gp.is_alive and gp.dead_until <= now()
  returning gp.* into v_player;
  if not found then return null; end if;

  v_event := jsonb_build_object(
    'event_id', gen_random_uuid(), 'type', 'player_respawned', 'game_id', p_game_id,
    'player', private.combat_player_snapshot(p_game_id, p_player_id)
  );
  perform private.publish_combat_event(p_game_id, v_event);
  return v_event;
end;
$$;

create or replace function public.get_game_session()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_game_id uuid; v_room_code text; v_status text; v_result jsonb; v_player_id uuid;
begin
  if v_uid is null then raise exception 'Sign in before requesting a game session'; end if;

  select rp.room_id into v_game_id
  from public.room_players rp join public.rooms r on r.id = rp.room_id
  where rp.player_id = v_uid and r.status in ('STARTING', 'IN_MATCH')
  order by rp.joined_at desc limit 1;
  if v_game_id is null then raise exception 'No active match session'; end if;

  if not exists (select 1 from public.room_players rp where rp.player_id = v_uid and rp.room_id = v_game_id and rp.is_active) then
    if exists (select 1 from public.room_players rp where rp.player_id = v_uid and rp.is_active and rp.room_id <> v_game_id) then
      raise exception 'This player is already active in another room';
    end if;
    update public.room_players set is_active = true, is_ready = true, last_seen_at = now()
      where player_id = v_uid and room_id = v_game_id;
  end if;

  select r.code, r.status into v_room_code, v_status from public.rooms r where r.id = v_game_id for update;
  if v_status not in ('STARTING', 'IN_MATCH') then raise exception 'The game is no longer active'; end if;

  for v_player_id in
    select gp.player_id from public.game_players gp
    join public.room_players rp on rp.room_id = gp.game_id and rp.player_id = gp.player_id and rp.is_active
    where gp.game_id = v_game_id and not gp.is_alive and gp.dead_until <= now()
  loop
    perform private.respawn_game_player(v_game_id, v_player_id);
  end loop;

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
      'health', gp.health, 'kills', gp.kills, 'deaths', gp.deaths,
      'is_alive', gp.is_alive, 'dead_until', gp.dead_until,
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
    where rp.player_id = v_uid and rp.is_active and rp.last_seen_at > now() - interval '35 seconds'
      and r.status in ('STARTING', 'IN_MATCH') order by rp.joined_at desc limit 1;
  if v_game_id is null then raise exception 'No active game membership'; end if;
  perform private.respawn_game_player(v_game_id, v_uid);
  update public.game_players gp set position_x = p_x, position_y = p_y, position_z = p_z,
    rotation_y = p_rotation_y, velocity_y = p_velocity_y, grounded = p_grounded,
    jetpack_active = p_jetpack_active, last_seen_at = now(), updated_at = now()
  where gp.game_id = v_game_id and gp.player_id = v_uid and gp.is_alive
    and gp.updated_at < now() - interval '900 milliseconds';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.request_player_shot(p_dx double precision, p_dy double precision, p_dz double precision)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_game_id uuid; v_shooter public.game_players%rowtype;
  v_target public.game_players%rowtype; v_target_id uuid; v_room_player public.room_players%rowtype;
  v_now timestamptz := clock_timestamp(); v_len double precision; v_dx double precision; v_dy double precision; v_dz double precision;
  v_ox double precision; v_oy double precision; v_oz double precision; v_range constant double precision := 42.0;
  v_radius constant double precision := 0.58; v_best_t double precision := v_range; v_t double precision; v_dist2 double precision;
  v_cx double precision; v_cy double precision; v_cz double precision; v_entry double precision;
  v_events jsonb := '[]'::jsonb; v_event jsonb; v_shot_id uuid := gen_random_uuid(); v_health smallint;
  v_dead boolean := false; v_shooter_snapshot jsonb; v_target_snapshot jsonb;
begin
  if v_uid is null then raise exception 'Sign in before firing'; end if;
  if not (abs(p_dx) <= 1.0 and abs(p_dy) <= 1.0 and abs(p_dz) <= 1.0) then raise exception 'Aim direction is invalid'; end if;
  v_len := sqrt(p_dx*p_dx + p_dy*p_dy + p_dz*p_dz);
  if v_len < 0.98 or v_len > 1.02 then raise exception 'Aim direction must be normalized'; end if;
  v_dx := p_dx / v_len; v_dy := p_dy / v_len; v_dz := p_dz / v_len;

  select rp.room_id into v_game_id from public.room_players rp join public.rooms r on r.id = rp.room_id
  where rp.player_id = v_uid and rp.is_active and rp.last_seen_at > v_now - interval '35 seconds'
    and r.status in ('STARTING', 'IN_MATCH') order by rp.joined_at desc limit 1;
  if v_game_id is null then raise exception 'No connected active game membership'; end if;

  select gp.* into v_shooter from public.game_players gp
  where gp.game_id = v_game_id and gp.player_id = v_uid for update;
  if not found then raise exception 'Shooter state is unavailable'; end if;
  if not v_shooter.is_alive or v_shooter.health <= 0 then
    return jsonb_build_object('accepted', false, 'reason', 'player_dead', 'events', '[]'::jsonb);
  end if;
  if v_shooter.last_fire_at is not null and v_now < v_shooter.last_fire_at + interval '275 milliseconds' then
    return jsonb_build_object('accepted', false, 'reason', 'rate_limited', 'events', '[]'::jsonb);
  end if;

  v_ox := v_shooter.position_x; v_oy := v_shooter.position_y + 1.15; v_oz := v_shooter.position_z;
  for v_target in
    select gp.* from public.game_players gp
    join public.room_players rp on rp.room_id = gp.game_id and rp.player_id = gp.player_id
    where gp.game_id = v_game_id and gp.player_id <> v_uid and gp.is_alive and gp.health > 0
      and rp.is_active and rp.last_seen_at > v_now - interval '35 seconds'
  loop
    foreach v_cy in array array[v_target.position_y + 0.52, v_target.position_y + 1.30]::double precision[] loop
      v_cx := v_target.position_x; v_cz := v_target.position_z;
      v_t := greatest(0.0, least(v_range, (v_cx-v_ox)*v_dx + (v_cy-v_oy)*v_dy + (v_cz-v_oz)*v_dz));
      v_dist2 := power(v_ox+v_dx*v_t-v_cx,2) + power(v_oy+v_dy*v_t-v_cy,2) + power(v_oz+v_dz*v_t-v_cz,2);
      if v_dist2 <= v_radius*v_radius then
        v_entry := greatest(0.0, v_t - sqrt(greatest(0.0, v_radius*v_radius-v_dist2)));
        if v_entry < v_best_t then v_best_t := v_entry; v_target_id := v_target.player_id; end if;
      end if;
    end loop;
  end loop;

  update public.game_players set last_fire_at = v_now, last_seen_at = v_now
    where game_id = v_game_id and player_id = v_uid;

  v_event := jsonb_build_object(
    'event_id', gen_random_uuid(), 'type', 'shot_fired', 'game_id', v_game_id,
    'shot_id', v_shot_id, 'shooter_id', v_uid,
    'origin', jsonb_build_array(v_ox, v_oy, v_oz),
    'direction', jsonb_build_array(v_dx, v_dy, v_dz),
    'end', jsonb_build_array(v_ox+v_dx*v_best_t, v_oy+v_dy*v_best_t, v_oz+v_dz*v_best_t),
    'hit', v_target_id is not null, 'fired_at', v_now
  );
  v_events := v_events || jsonb_build_array(v_event);
  perform private.publish_combat_event(v_game_id, v_event);

  if v_target_id is not null then
    update public.game_players gp set
      health = greatest(0, gp.health - 25)::smallint,
      is_alive = gp.health - 25 > 0,
      dead_until = case when gp.health - 25 <= 0 then v_now + interval '2 seconds' else null end,
      deaths = gp.deaths + case when gp.health - 25 <= 0 then 1 else 0 end,
      last_seen_at = v_now, updated_at = v_now
    where gp.game_id = v_game_id and gp.player_id = v_target_id
    returning health, not is_alive into v_health, v_dead;

    if v_dead then
      update public.game_players set kills = kills + 1, updated_at = v_now
      where game_id = v_game_id and player_id = v_uid;
    end if;
    v_target_snapshot := private.combat_player_snapshot(v_game_id, v_target_id);
    v_shooter_snapshot := private.combat_player_snapshot(v_game_id, v_uid);
    v_event := jsonb_build_object('event_id', gen_random_uuid(), 'type', 'player_damaged',
      'game_id', v_game_id, 'shot_id', v_shot_id, 'shooter_id', v_uid, 'target_id', v_target_id,
      'damage', 25, 'player', v_target_snapshot, 'shooter', v_shooter_snapshot);
    v_events := v_events || jsonb_build_array(v_event);
    perform private.publish_combat_event(v_game_id, v_event);

    if v_dead then
      v_event := jsonb_build_object('event_id', gen_random_uuid(), 'type', 'player_died',
        'game_id', v_game_id, 'shot_id', v_shot_id, 'player', v_target_snapshot, 'killer', v_shooter_snapshot);
      v_events := v_events || jsonb_build_array(v_event);
      perform private.publish_combat_event(v_game_id, v_event);
      v_event := jsonb_build_object('event_id', gen_random_uuid(), 'type', 'elimination',
        'game_id', v_game_id, 'shot_id', v_shot_id, 'player', v_shooter_snapshot, 'victim', v_target_snapshot);
      v_events := v_events || jsonb_build_array(v_event);
      perform private.publish_combat_event(v_game_id, v_event);
    end if;
  end if;
  return jsonb_build_object('accepted', true, 'hit', v_target_id is not null, 'events', v_events);
end;
$$;

create or replace function public.respawn_game_player()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_game_id uuid; v_event jsonb; v_retry integer;
begin
  if v_uid is null then raise exception 'Sign in before respawning'; end if;
  select rp.room_id into v_game_id from public.room_players rp join public.rooms r on r.id = rp.room_id
  where rp.player_id = v_uid and rp.is_active and r.status in ('STARTING', 'IN_MATCH')
  order by rp.joined_at desc limit 1;
  if v_game_id is null then raise exception 'No active game membership'; end if;
  v_event := private.respawn_game_player(v_game_id, v_uid);
  if v_event is not null then return jsonb_build_object('accepted', true, 'events', jsonb_build_array(v_event)); end if;
  select greatest(0, ceil(extract(epoch from gp.dead_until - clock_timestamp()) * 1000))::integer into v_retry
  from public.game_players gp where gp.game_id = v_game_id and gp.player_id = v_uid and not gp.is_alive;
  if v_retry is null then return jsonb_build_object('accepted', false, 'reason', 'already_alive', 'events', '[]'::jsonb); end if;
  return jsonb_build_object('accepted', false, 'reason', 'respawn_wait', 'retry_after_ms', v_retry, 'events', '[]'::jsonb);
end;
$$;

revoke all on function public.request_player_shot(double precision,double precision,double precision), public.respawn_game_player() from public, anon;
grant execute on function public.request_player_shot(double precision,double precision,double precision), public.respawn_game_player() to authenticated;
revoke all on function private.combat_player_snapshot(uuid,uuid), private.publish_combat_event(uuid,jsonb), private.respawn_game_player(uuid,uuid) from public, anon, authenticated;
comment on column public.game_players.health is 'Authoritative multiplayer health; updated only by server combat RPCs.';
comment on function public.request_player_shot(double precision,double precision,double precision) is 'Validates a VX-9 fire request, rate-limits it, resolves a hit against active player capsules, and applies authoritative damage.';
