drop function public.request_player_shot(double precision, double precision, double precision);

create function public.request_player_shot(
  p_dx double precision,
  p_dy double precision,
  p_dz double precision,
  p_debug boolean default false
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_game_id uuid; v_shooter public.game_players%rowtype;
  v_target record; v_target_id uuid; v_now timestamptz := clock_timestamp();
  v_len double precision; v_dx double precision; v_dy double precision; v_dz double precision;
  v_yaw double precision; v_horizontal double precision; v_ox double precision; v_oy double precision; v_oz double precision;
  v_range constant double precision := 42.0; v_radius constant double precision := 0.58;
  v_projection double precision; v_dist2 double precision; v_distance double precision; v_nearest_distance double precision;
  v_nearest_projection double precision; v_entry double precision; v_target_entry double precision;
  v_cx double precision; v_cy double precision; v_cz double precision;
  v_target_id_candidate uuid; v_reason text; v_target_debug jsonb; v_debug_targets jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb; v_event jsonb; v_shot_id uuid := gen_random_uuid();
  v_health smallint; v_dead boolean := false; v_shooter_snapshot jsonb; v_target_snapshot jsonb;
  v_camera jsonb; v_normalized jsonb; v_submitted jsonb;
begin
  if v_uid is null then raise exception 'Sign in before firing'; end if;
  if p_dx is null or p_dy is null or p_dz is null
     or abs(p_dx) > 1.0 or abs(p_dy) > 1.0 or abs(p_dz) > 1.0 then
    raise exception 'Aim direction is invalid';
  end if;
  v_len := sqrt(p_dx*p_dx + p_dy*p_dy + p_dz*p_dz);
  if v_len < 0.98 or v_len > 1.02 then raise exception 'Aim direction must be normalized'; end if;
  v_dx := p_dx / v_len; v_dy := p_dy / v_len; v_dz := p_dz / v_len;
  v_submitted := jsonb_build_array(p_dx,p_dy,p_dz);
  v_normalized := jsonb_build_array(v_dx,v_dy,v_dz);

  select rp.room_id into v_game_id from public.room_players rp
  join public.rooms r on r.id = rp.room_id
  where rp.player_id = v_uid and rp.is_active and rp.last_seen_at > v_now - interval '35 seconds'
    and r.status in ('STARTING', 'IN_MATCH') order by rp.joined_at desc limit 1;
  if v_game_id is null then raise exception 'No connected active game membership'; end if;

  select gp.* into v_shooter from public.game_players gp
  where gp.game_id = v_game_id and gp.player_id = v_uid for update;
  if not found then raise exception 'Shooter state is unavailable'; end if;
  if not v_shooter.is_alive or v_shooter.health <= 0 then
    return jsonb_build_object('accepted', false, 'reason', 'player_dead', 'events', '[]'::jsonb,
      'debug', case when p_debug then jsonb_build_object('reason','player_dead','shooter_position',jsonb_build_array(v_shooter.position_x,v_shooter.position_y,v_shooter.position_z),'submitted_direction',v_submitted,'normalized_direction',v_normalized) else null end);
  end if;
  if v_shooter.last_fire_at is not null and v_now < v_shooter.last_fire_at + interval '275 milliseconds' then
    return jsonb_build_object('accepted', false, 'reason', 'rate_limited', 'events', '[]'::jsonb,
      'debug', case when p_debug then jsonb_build_object('reason','rate_limited','retry_after_ms',ceil(extract(epoch from (v_shooter.last_fire_at + interval '275 milliseconds' - v_now))*1000)) else null end);
  end if;

  -- Reconstruct the third-person camera origin from server-owned body position.
  -- Direction supplies only the view yaw; the client cannot choose its origin.
  v_horizontal := sqrt(v_dx*v_dx + v_dz*v_dz);
  v_yaw := case when v_horizontal > 0.05 then atan2(-v_dx,-v_dz) else v_shooter.rotation_y end;
  v_ox := v_shooter.position_x + 5.8*sin(v_yaw) + 1.18*cos(v_yaw);
  v_oy := v_shooter.position_y + 2.34;
  v_oz := v_shooter.position_z + 5.8*cos(v_yaw) - 1.18*sin(v_yaw);
  v_camera := jsonb_build_array(v_ox,v_oy,v_oz);

  v_target_entry := v_range + 1;
  for v_target in
    select gp.*, coalesce(rp.is_active,false) as member_active,
      (rp.last_seen_at > v_now - interval '35 seconds') as member_recent
    from public.game_players gp
    left join public.room_players rp on rp.room_id = gp.game_id and rp.player_id = gp.player_id
    where gp.game_id = v_game_id and gp.player_id <> v_uid
  loop
    v_reason := null; v_nearest_distance := 'Infinity'::double precision; v_nearest_projection := null; v_entry := null;
    if not v_target.member_active or not coalesce(v_target.member_recent,false) then
      v_reason := 'inactive_or_disconnected';
    elsif not v_target.is_alive or v_target.health <= 0 then
      v_reason := 'target_dead';
    else
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
      if v_nearest_projection is null then
        if ((v_target.position_x-v_ox)*v_dx + (v_target.position_y+0.91-v_oy)*v_dy + (v_target.position_z-v_oz)*v_dz) <= 0 then
          v_reason := 'behind_shooter';
        else
          v_reason := 'out_of_range';
        end if;
      elsif v_nearest_distance <= v_radius then
        v_reason := 'hit';
        if v_entry < v_target_entry then v_target_entry := v_entry; v_target_id := v_target.player_id; end if;
      else
        v_reason := 'ray_miss';
      end if;
    end if;
    if p_debug then
      v_target_debug := jsonb_build_object(
        'name',v_target.display_name,
        'position',jsonb_build_array(v_target.position_x,v_target.position_y,v_target.position_z),
        'alive',v_target.is_alive,'active',v_target.member_active,
        'checkpoint_age_ms',greatest(0,ceil(extract(epoch from (v_now-v_target.updated_at))*1000)),
        'projection',v_nearest_projection,'distance_to_ray',case when v_nearest_distance = 'Infinity'::double precision then null else v_nearest_distance end,
        'max_range',v_range,'hit_radius',v_radius,'result',v_reason);
      v_debug_targets := v_debug_targets || jsonb_build_array(v_target_debug);
    end if;
  end loop;

  update public.game_players set last_fire_at = v_now, last_seen_at = v_now
    where game_id = v_game_id and player_id = v_uid;

  v_event := jsonb_build_object(
    'event_id', gen_random_uuid(), 'type', 'shot_fired', 'game_id', v_game_id,
    'shot_id', v_shot_id, 'shooter_id', v_uid,
    'origin', jsonb_build_array(v_ox,v_oy,v_oz),
    'direction', jsonb_build_array(v_dx,v_dy,v_dz),
    'end', jsonb_build_array(v_ox+v_dx*least(v_range,greatest(0.0,v_target_entry)), v_oy+v_dy*least(v_range,greatest(0.0,v_target_entry)), v_oz+v_dz*least(v_range,greatest(0.0,v_target_entry))),
    'hit', v_target_id is not null, 'fired_at', v_now
  );
  v_events := v_events || jsonb_build_array(v_event);
  perform private.publish_combat_event(v_game_id,v_event);

  if v_target_id is not null then
    update public.game_players gp set
      health = greatest(0,gp.health-25)::smallint,
      is_alive = gp.health-25 > 0,
      dead_until = case when gp.health-25 <= 0 then v_now + interval '2 seconds' else null end,
      deaths = gp.deaths + case when gp.health-25 <= 0 then 1 else 0 end,
      last_seen_at = v_now, updated_at = v_now
    where gp.game_id = v_game_id and gp.player_id = v_target_id
    returning health, not is_alive into v_health,v_dead;
    if v_dead then
      update public.game_players set kills = kills+1, updated_at=v_now where game_id=v_game_id and player_id=v_uid;
    end if;
    v_target_snapshot := private.combat_player_snapshot(v_game_id,v_target_id);
    v_shooter_snapshot := private.combat_player_snapshot(v_game_id,v_uid);
    v_event := jsonb_build_object('event_id',gen_random_uuid(),'type','player_damaged','game_id',v_game_id,
      'shot_id',v_shot_id,'shooter_id',v_uid,'target_id',v_target_id,'damage',25,
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
  end if;

  return jsonb_build_object('accepted',true,'hit',v_target_id is not null,'events',v_events,
    'debug',case when p_debug then jsonb_build_object(
      'shooter_position',jsonb_build_array(v_shooter.position_x,v_shooter.position_y,v_shooter.position_z),
      'camera_origin',v_camera,'submitted_direction',v_submitted,'normalized_direction',v_normalized,
      'max_range',v_range,'hit_radius',v_radius,'targets',v_debug_targets,
      'decision',case when v_target_id is null then 'miss' else 'hit' end) else null end);
end;
$$;

revoke all on function public.request_player_shot(double precision,double precision,double precision,boolean) from public,anon;
grant execute on function public.request_player_shot(double precision,double precision,double precision,boolean) to authenticated;
comment on function public.request_player_shot(double precision,double precision,double precision,boolean)
is 'Validates VX-9 fire requests, reconstructs the server-trusted third-person camera origin, resolves capsule hits, and applies authoritative damage. p_debug returns transient diagnostic geometry to the requesting active player only.';
