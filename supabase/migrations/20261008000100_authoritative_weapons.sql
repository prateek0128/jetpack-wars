-- Phase 2F: weapon state is writable only through authenticated, server-validated RPCs.
alter table public.game_players
  add column selected_weapon text not null default 'VX9' check(selected_weapon in ('VX9','SH8')),
  add column vx9_ammo smallint not null default 12 check(vx9_ammo between 0 and 12),
  add column sh8_ammo smallint not null default 6 check(sh8_ammo between 0 and 6),
  add column reload_weapon text check(reload_weapon in ('VX9','SH8')),
  add column reload_ends_at timestamptz,
  add column vx9_last_fire_at timestamptz,
  add column sh8_last_fire_at timestamptz,
  add column weapon_updated_at timestamptz not null default clock_timestamp();

create function private.finish_weapon_reload(p_game_id uuid,p_player_id uuid)
returns void language sql security definer set search_path='' as $$
  update public.game_players set
    vx9_ammo=case when reload_weapon='VX9' then 12 else vx9_ammo end,
    sh8_ammo=case when reload_weapon='SH8' then 6 else sh8_ammo end,
    reload_weapon=null,reload_ends_at=null,weapon_updated_at=clock_timestamp()
  where game_id=p_game_id and player_id=p_player_id and is_alive and reload_ends_at<=clock_timestamp();
$$;

-- Reset both magazines on a new match and on respawn without changing match/respawn logic.
create function private.reset_weapon_loadout()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.is_alive and not old.is_alive) or (new.last_fire_at is null and new.kills=0 and new.deaths=0 and new.health=100) then
    new.selected_weapon:='VX9'; new.vx9_ammo:=12; new.sh8_ammo:=6;
    new.reload_weapon:=null; new.reload_ends_at:=null;
    new.vx9_last_fire_at:=null; new.sh8_last_fire_at:=null; new.weapon_updated_at:=clock_timestamp();
  elsif not new.is_alive then
    new.reload_weapon:=null; new.reload_ends_at:=null; new.weapon_updated_at:=clock_timestamp();
  end if;
  return new;
end $$;
create trigger reset_weapon_loadout before update of is_alive,last_fire_at on public.game_players
for each row execute function private.reset_weapon_loadout();

create or replace function private.combat_player_snapshot(p_game_id uuid, p_player_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'player_id', gp.player_id, 'display_name', gp.display_name,
    'selected_weapon',gp.selected_weapon,'vx9_ammo',gp.vx9_ammo,'sh8_ammo',gp.sh8_ammo,
    'reload_weapon',gp.reload_weapon,'reload_ends_at',gp.reload_ends_at,'weapon_updated_at',gp.weapon_updated_at,
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

create or replace function public.get_game_session()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_game_id uuid; v_code text; v_host uuid; v_result jsonb;
begin
  if v_uid is null then raise exception 'Sign in before requesting a game session'; end if;
  select r.id into v_game_id from public.room_players rp join public.rooms r on r.id=rp.room_id
    where rp.player_id=v_uid and r.match_state in ('COUNTDOWN','ACTIVE','FINISHED','RESULTS')
    order by rp.joined_at desc limit 1;
  if v_game_id is null then raise exception 'No active match session'; end if;
  update public.room_players set is_active=true,is_ready=true,last_seen_at=now()
    where room_id=v_game_id and player_id=v_uid;
  perform private.advance_match(v_game_id);
  select code,host_player_id into v_code,v_host from public.rooms where id=v_game_id;
  with spawns(slot,x,y,z) as (values (1,-4.0,0.0,5.0),(2,4.0,0.0,-5.0),(3,-4.0,0.0,-5.0),(4,4.0,0.0,5.0),
    (5,-12.0,2.98,0.0),(6,12.0,2.98,0.0),(7,0.0,4.6,-13.0),(8,0.0,2.425,13.0)), members as (
      select rp.player_id,rp.display_name,row_number() over(order by rp.joined_at,rp.player_id) slot
      from public.room_players rp where rp.room_id=v_game_id and rp.is_active)
  insert into public.game_players(game_id,player_id,display_name,spawn_x,spawn_y,spawn_z,position_x,position_y,position_z,
    rotation_y,grounded,last_seen_at)
  select v_game_id,m.player_id,m.display_name,s.x,s.y,s.z,s.x,s.y,s.z,atan2(s.x,s.z),true,now()
    from members m join spawns s on s.slot=m.slot
  on conflict(game_id,player_id) do update set display_name=excluded.display_name;
  perform private.finish_weapon_reload(v_game_id,v_uid);
  select jsonb_build_object('game_id',v_game_id,'room_code',v_code,'player_id',v_uid,'host_player_id',v_host,
    'match',private.match_snapshot(v_game_id),
    'players',coalesce(jsonb_agg(jsonb_build_object('player_id',gp.player_id,'display_name',gp.display_name,
      'spawn_position',jsonb_build_array(gp.spawn_x,gp.spawn_y,gp.spawn_z),
      'position',jsonb_build_array(gp.position_x,gp.position_y,gp.position_z),'rotation_y',gp.rotation_y,
      'velocity_y',gp.velocity_y,'grounded',gp.grounded,'jetpack_active',gp.jetpack_active,
      'selected_weapon',gp.selected_weapon,'vx9_ammo',gp.vx9_ammo,'sh8_ammo',gp.sh8_ammo,
      'reload_weapon',gp.reload_weapon,'reload_ends_at',gp.reload_ends_at,'weapon_updated_at',gp.weapon_updated_at,
      'health',gp.health,'kills',gp.kills,'deaths',gp.deaths,'is_alive',gp.is_alive,'dead_until',gp.dead_until,
      'last_seen_at',gp.last_seen_at,'is_active',coalesce(rp.is_active,false))
      order by coalesce(rp.joined_at,gp.updated_at),gp.player_id),'[]'::jsonb)) into v_result
  from public.game_players gp left join public.room_players rp on rp.room_id=gp.game_id and rp.player_id=gp.player_id
  where gp.game_id=v_game_id;
  return v_result;
end;
$$;

-- Authenticated membership + ACTIVE match + room lock shared by switching/reloading/firing.
create function private.weapon_game()
returns uuid language plpgsql security definer set search_path='' as $$
declare v_game uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before using weapons'; end if;
  select rp.room_id into v_game from public.room_players rp join public.rooms r on r.id=rp.room_id
  where rp.player_id=auth.uid() and rp.is_active and rp.last_seen_at>clock_timestamp()-interval '35 seconds'
    and r.match_state in ('COUNTDOWN','ACTIVE') order by rp.joined_at desc limit 1;
  if v_game is null then raise exception 'No connected active game membership'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_game::text,0));
  perform private.advance_match(v_game);
  if not exists(select 1 from public.rooms where id=v_game and match_state='ACTIVE' and ends_at>clock_timestamp()) then
    raise exception 'Match is not active';
  end if;
  return v_game;
end $$;

create function public.get_weapon_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game uuid;
begin
  v_game:=private.weapon_game();
  perform private.finish_weapon_reload(v_game,auth.uid());
  return private.combat_player_snapshot(v_game,auth.uid());
end $$;

create function public.switch_weapon(p_weapon text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game uuid; v_player public.game_players%rowtype; v_event jsonb;
begin
  if p_weapon is null or p_weapon not in ('VX9','SH8') then raise exception 'Unsupported weapon'; end if;
  v_game:=private.weapon_game();
  perform private.finish_weapon_reload(v_game,auth.uid());
  select * into v_player from public.game_players where game_id=v_game and player_id=auth.uid() for update;
  if not found or not v_player.is_alive then raise exception 'Player is dead or unavailable'; end if;
  if v_player.selected_weapon<>p_weapon then
    update public.game_players set selected_weapon=p_weapon,reload_weapon=null,reload_ends_at=null,weapon_updated_at=clock_timestamp()
      where game_id=v_game and player_id=auth.uid();
    v_event:=jsonb_build_object('event_id',gen_random_uuid(),'type','weapon_changed','game_id',v_game,
      'player',private.combat_player_snapshot(v_game,auth.uid()));
    perform private.publish_combat_event(v_game,v_event);
  end if;
  return private.combat_player_snapshot(v_game,auth.uid());
end $$;

create function public.reload_weapon()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game uuid; v_player public.game_players%rowtype;
begin
  v_game:=private.weapon_game();
  perform private.finish_weapon_reload(v_game,auth.uid());
  select * into v_player from public.game_players where game_id=v_game and player_id=auth.uid() for update;
  if not found or not v_player.is_alive then raise exception 'Player is dead or unavailable'; end if;
  if v_player.reload_weapon is null and
    ((v_player.selected_weapon='VX9' and v_player.vx9_ammo<12) or (v_player.selected_weapon='SH8' and v_player.sh8_ammo<6)) then
    update public.game_players set reload_weapon=selected_weapon,
      reload_ends_at=clock_timestamp()+case when selected_weapon='VX9' then interval '1100 milliseconds' else interval '1600 milliseconds' end,
      weapon_updated_at=clock_timestamp() where game_id=v_game and player_id=auth.uid();
  end if;
  return private.combat_player_snapshot(v_game,auth.uid());
end $$;

-- Remove the legacy overload so old requests cannot bypass weapon/ammo validation.
drop function public.request_player_shot(double precision,double precision,double precision);
create function public.request_player_shot(p_weapon text, p_dx double precision, p_dy double precision, p_dz double precision)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_game_id uuid; v_shooter public.game_players%rowtype;
  v_target record; v_target_id uuid; v_now timestamptz := clock_timestamp();
  v_len double precision; v_dx double precision; v_dy double precision; v_dz double precision;
  v_yaw double precision; v_horizontal double precision; v_ox double precision; v_oy double precision; v_oz double precision;
  v_range double precision; v_radius constant double precision := 0.58;
  v_projection double precision; v_dist2 double precision; v_distance double precision; v_nearest_distance double precision;
  v_nearest_projection double precision; v_entry double precision; v_target_entry double precision;
  v_cx double precision; v_cy double precision; v_cz double precision;
  v_target_id_candidate uuid; v_reason text;
  v_events jsonb := '[]'::jsonb; v_event jsonb; v_shot_id uuid := gen_random_uuid();
  v_health smallint; v_dead boolean := false; v_shooter_snapshot jsonb; v_target_snapshot jsonb;
  v_pellet integer; v_count integer; v_damage integer; v_ammo integer; v_last timestamptz; v_interval interval;
  v_base_x double precision; v_base_y double precision; v_base_z double precision;
  v_rx double precision; v_rz double precision; v_ux double precision; v_uy double precision; v_uz double precision;
  v_sx double precision; v_sy double precision; v_spread double precision:=tan(radians(4.5));
  v_offsets_x double precision[]:=array[0,0.35,-0.35,0,0,0.707,-0.707,0];
  v_offsets_y double precision[]:=array[0,0,0,0.35,-0.35,0.707,0.707,-1];
  v_pellets jsonb:='[]'::jsonb; v_hits jsonb:='{}'::jsonb; v_hit record;
begin
  if p_weapon is null or p_weapon not in ('VX9','SH8') then raise exception 'Unsupported weapon'; end if;
  if v_uid is null then raise exception 'Sign in before firing'; end if;
  if p_dx is null or p_dy is null or p_dz is null
     or abs(p_dx) > 1.0 or abs(p_dy) > 1.0 or abs(p_dz) > 1.0 then
    raise exception 'Aim direction is invalid';
  end if;
  v_len := sqrt(p_dx*p_dx + p_dy*p_dy + p_dz*p_dz);
  if v_len < 0.98 or v_len > 1.02 then raise exception 'Aim direction must be normalized'; end if;
  v_dx := p_dx / v_len; v_dy := p_dy / v_len; v_dz := p_dz / v_len;

  v_game_id:=private.weapon_game();
  v_now:=clock_timestamp();
  perform private.finish_weapon_reload(v_game_id,v_uid);
  select gp.* into v_shooter from public.game_players gp
  where gp.game_id = v_game_id and gp.player_id = v_uid for update;
  if not found then raise exception 'Shooter state is unavailable'; end if;
  if not v_shooter.is_alive or v_shooter.health <= 0 then
    return jsonb_build_object('accepted', false, 'reason', 'player_dead', 'events', '[]'::jsonb);
  end if;
  if v_shooter.selected_weapon<>p_weapon then
    return jsonb_build_object('accepted',false,'reason','weapon_mismatch','player',private.combat_player_snapshot(v_game_id,v_uid),'events','[]'::jsonb);
  end if;
  v_ammo:=case when p_weapon='VX9' then v_shooter.vx9_ammo else v_shooter.sh8_ammo end;
  v_last:=case when p_weapon='VX9' then v_shooter.vx9_last_fire_at else v_shooter.sh8_last_fire_at end;
  v_interval:=case when p_weapon='VX9' then interval '275 milliseconds' else interval '850 milliseconds' end;
  if v_shooter.reload_weapon is not null or v_ammo<=0 or
    (v_last is not null and v_now<v_last+v_interval) then
    return jsonb_build_object('accepted',false,'reason',case when v_shooter.reload_weapon is not null then 'reloading' when v_ammo<=0 then 'empty' else 'rate_limited' end,
      'player',private.combat_player_snapshot(v_game_id,v_uid),'events','[]'::jsonb);
  end if;
  v_range:=case when p_weapon='VX9' then 42 else 16 end;
  v_damage:=case when p_weapon='VX9' then 25 else 8 end;
  v_count:=case when p_weapon='VX9' then 1 else 8 end;
  -- Reconstruct the camera origin from server-owned position; direction only determines yaw.
  v_horizontal := sqrt(v_dx*v_dx + v_dz*v_dz);
  v_yaw := case when v_horizontal > 0.05 then atan2(-v_dx,-v_dz) else v_shooter.rotation_y end;
  v_ox := v_shooter.position_x + 5.8*sin(v_yaw) + 1.18*cos(v_yaw);
  v_oy := v_shooter.position_y + 2.34;
  v_oz := v_shooter.position_z + 5.8*cos(v_yaw) - 1.18*sin(v_yaw);

  v_base_x:=v_dx; v_base_y:=v_dy; v_base_z:=v_dz;
  if v_horizontal>0.01 then v_rx:=v_dz/v_horizontal; v_rz:=-v_dx/v_horizontal;
  else v_rx:=1; v_rz:=0; end if;
  v_ux:=-v_rz*v_dy; v_uy:=v_rz*v_dx-v_rx*v_dz; v_uz:=v_rx*v_dy;
  for v_pellet in 1..v_count loop
    v_sx:=case when p_weapon='SH8' then v_offsets_x[v_pellet]*v_spread else 0 end;
    v_sy:=case when p_weapon='SH8' then v_offsets_y[v_pellet]*v_spread else 0 end;
    v_dx:=v_base_x+v_rx*v_sx+v_ux*v_sy;
    v_dy:=v_base_y+v_uy*v_sy;
    v_dz:=v_base_z+v_rz*v_sx+v_uz*v_sy;
    v_len:=sqrt(v_dx*v_dx+v_dy*v_dy+v_dz*v_dz); v_dx:=v_dx/v_len; v_dy:=v_dy/v_len; v_dz:=v_dz/v_len;
    v_target_id:=null;
  v_target_entry := v_range + 1;
  for v_target in
    select gp.*, coalesce(rp.is_active,false) as member_active,
      (rp.last_seen_at > v_now - interval '35 seconds') as member_recent
    from public.game_players gp
    left join public.room_players rp on rp.room_id = gp.game_id and rp.player_id = gp.player_id
    where gp.game_id = v_game_id and gp.player_id <> v_uid
  loop
    if v_target.member_active and coalesce(v_target.member_recent,false)
       and v_target.is_alive and v_target.health > 0 then
      v_nearest_distance := 'Infinity'::double precision;
      v_nearest_projection := null; v_entry := null;
      foreach v_cy in array array[v_target.position_y + 0.52, v_target.position_y + 1.30]::double precision[] loop
        v_cx := v_target.position_x; v_cz := v_target.position_z;
        v_projection := (v_cx-v_ox)*v_dx + (v_cy-v_oy)*v_dy + (v_cz-v_oz)*v_dz;
        if v_projection > 0 and v_projection <= v_range then
          v_dist2 := power(v_ox+v_dx*v_projection-v_cx,2)
            + power(v_oy+v_dy*v_projection-v_cy,2)
            + power(v_oz+v_dz*v_projection-v_cz,2);
          v_distance := sqrt(v_dist2);
          if v_distance < v_nearest_distance then
            v_nearest_distance := v_distance; v_nearest_projection := v_projection;
            v_entry := greatest(0.0, v_projection - sqrt(greatest(0.0,v_radius*v_radius-v_dist2)));
          end if;
        end if;
      end loop;
      if v_nearest_projection is not null and v_nearest_distance <= v_radius
         and v_entry < v_target_entry then
        v_target_entry := v_entry; v_target_id := v_target.player_id;
      end if;
    end if;
  end loop;

    v_pellets:=v_pellets||jsonb_build_array(jsonb_build_object('direction',jsonb_build_array(v_dx,v_dy,v_dz),
      'end',jsonb_build_array(v_ox+v_dx*least(v_range,v_target_entry),v_oy+v_dy*least(v_range,v_target_entry),v_oz+v_dz*least(v_range,v_target_entry)),
      'target_id',v_target_id,'hit',v_target_id is not null));
    if v_target_id is not null then
      v_hits:=jsonb_set(v_hits,array[v_target_id::text],to_jsonb(coalesce((v_hits->>v_target_id::text)::integer,0)+v_damage));
    end if;
  end loop;
  update public.game_players set last_fire_at=v_now,last_seen_at=v_now,weapon_updated_at=v_now,
    vx9_ammo=vx9_ammo-case when p_weapon='VX9' then 1 else 0 end,
    sh8_ammo=sh8_ammo-case when p_weapon='SH8' then 1 else 0 end,
    vx9_last_fire_at=case when p_weapon='VX9' then v_now else vx9_last_fire_at end,
    sh8_last_fire_at=case when p_weapon='SH8' then v_now else sh8_last_fire_at end
    where game_id = v_game_id and player_id = v_uid;
  v_event := jsonb_build_object(
    'event_id', gen_random_uuid(), 'type', 'shot_fired', 'game_id', v_game_id,
    'shot_id',v_shot_id,'shooter_id',v_uid,'weapon',p_weapon,'pellets',v_pellets,'shooter',private.combat_player_snapshot(v_game_id,v_uid),
    'origin', jsonb_build_array(v_ox,v_oy,v_oz),
    'direction',jsonb_build_array(v_base_x,v_base_y,v_base_z),
    'end', jsonb_build_array(v_ox+v_dx*least(v_range,greatest(0.0,v_target_entry)), v_oy+v_dy*least(v_range,greatest(0.0,v_target_entry)), v_oz+v_dz*least(v_range,greatest(0.0,v_target_entry))),
    'hit',v_hits<>'{}'::jsonb, 'fired_at', v_now
  );
  v_events := v_events || jsonb_build_array(v_event);
  perform private.publish_combat_event(v_game_id,v_event);

  for v_hit in select key,value from jsonb_each_text(v_hits) loop
    v_target_id:=v_hit.key::uuid; v_damage:=v_hit.value::integer;
    update public.game_players gp set
      health = greatest(0,gp.health-v_damage)::smallint,
      is_alive = gp.health-v_damage > 0,
      dead_until = case when gp.health-v_damage <= 0 then v_now + interval '2 seconds' else null end,
      deaths = gp.deaths + case when gp.health-v_damage <= 0 then 1 else 0 end,
      last_seen_at = v_now, updated_at = v_now
    where gp.game_id = v_game_id and gp.player_id = v_target_id
    returning health, not is_alive into v_health,v_dead;
    if v_dead then
      update public.game_players set kills = kills+1, updated_at=v_now where game_id=v_game_id and player_id=v_uid;
    end if;
    v_target_snapshot := private.combat_player_snapshot(v_game_id,v_target_id);
    v_shooter_snapshot := private.combat_player_snapshot(v_game_id,v_uid);
    v_event := jsonb_build_object('event_id',gen_random_uuid(),'type','player_damaged','game_id',v_game_id,
      'shot_id',v_shot_id,'shooter_id',v_uid,'target_id',v_target_id,'damage',v_damage,'weapon',p_weapon,
      'player',v_target_snapshot,'shooter',v_shooter_snapshot);
    v_events := v_events || jsonb_build_array(v_event); perform private.publish_combat_event(v_game_id,v_event);
    if v_dead then
      v_event := jsonb_build_object('event_id',gen_random_uuid(),'type','player_died','game_id',v_game_id,
        'shot_id',v_shot_id,'player',v_target_snapshot,'killer',v_shooter_snapshot);
      v_events := v_events || jsonb_build_array(v_event); perform private.publish_combat_event(v_game_id,v_event);
      v_event := jsonb_build_object('event_id',gen_random_uuid(),'type','elimination','game_id',v_game_id,
        'shot_id',v_shot_id,'player',v_shooter_snapshot,'victim',v_target_snapshot);
      v_events := v_events || jsonb_build_array(v_event); perform private.publish_combat_event(v_game_id,v_event);
    end if;
  end loop;
  return jsonb_build_object('accepted',true,'hit',v_hits<>'{}'::jsonb,'player',private.combat_player_snapshot(v_game_id,v_uid),'events',v_events);
end;
$$;


revoke all on function private.finish_weapon_reload(uuid,uuid),private.reset_weapon_loadout(),private.weapon_game() from public,anon,authenticated;
revoke all on function public.switch_weapon(text),public.reload_weapon(),public.get_weapon_state(),public.request_player_shot(text,double precision,double precision,double precision) from public,anon;
grant execute on function public.switch_weapon(text),public.reload_weapon(),public.get_weapon_state(),public.request_player_shot(text,double precision,double precision,double precision) to authenticated;
comment on function public.request_player_shot(text,double precision,double precision,double precision) is 'Server-owned weapons, ammo, reload, cooldown, deterministic pellets and damage. Arena occlusion is not tested.';
