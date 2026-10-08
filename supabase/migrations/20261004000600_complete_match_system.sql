alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
  check (status in ('LOBBY','STARTING','IN_MATCH','FINISHED'));
alter table public.rooms
  add column if not exists match_state text not null default 'LOBBY'
    check (match_state in ('LOBBY','COUNTDOWN','ACTIVE','FINISHED','RESULTS')),
  add column if not exists countdown_ends_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists results_at timestamptz,
  add column if not exists winner_player_id uuid;
update public.rooms set match_state='ACTIVE',started_at=coalesce(started_at,now()),ends_at=coalesce(ends_at,now()+interval '5 minutes')
  where status='IN_MATCH' and match_state='LOBBY';
update public.rooms set match_state='COUNTDOWN',countdown_ends_at=coalesce(countdown_ends_at,now()+interval '3 seconds')
  where status='STARTING' and match_state='LOBBY';

create table if not exists private.match_config (
  id boolean primary key default true check (id),
  duration_seconds integer not null default 300 check (duration_seconds between 30 and 300)
);
insert into private.match_config(id,duration_seconds) values(true,300) on conflict(id) do nothing;
revoke all on private.match_config from public, anon, authenticated;
grant select,insert,update,delete on private.match_config to service_role;

create or replace function private.match_scores(p_game_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id',gp.player_id,'display_name',gp.display_name,
    'eliminations',gp.kills,'kills',gp.kills,'deaths',gp.deaths,'score',gp.kills
  ) order by gp.kills desc,gp.deaths asc,gp.player_id), '[]'::jsonb)
  from public.game_players gp where gp.game_id=p_game_id
$$;

create or replace function private.match_snapshot(p_game_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('match_state',r.match_state,'countdown_ends_at',r.countdown_ends_at,
    'started_at',r.started_at,'ends_at',r.ends_at,'finished_at',r.finished_at,
    'winner_player_id',r.winner_player_id,
    'winner_name',(select gp.display_name from public.game_players gp where gp.game_id=r.id and gp.player_id=r.winner_player_id),
    'scores',private.match_scores(r.id),'server_now',clock_timestamp())
  from public.rooms r where r.id=p_game_id
$$;

create or replace function private.advance_match(p_game_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room public.rooms%rowtype; v_event jsonb; v_winner uuid; v_tied boolean; v_duration integer;
begin
  select * into v_room from public.rooms where id=p_game_id for update;
  if not found then return; end if;
  if v_room.match_state='COUNTDOWN' and v_room.countdown_ends_at<=clock_timestamp() then
    select duration_seconds into v_duration from private.match_config where id=true;
    update public.rooms set match_state='ACTIVE',status='IN_MATCH',started_at=countdown_ends_at,
      ends_at=countdown_ends_at+make_interval(secs=>v_duration),updated_at=clock_timestamp()
      where id=p_game_id returning * into v_room;
    v_event:=jsonb_build_object('event_id',gen_random_uuid(),'type','match_started','game_id',p_game_id,
      'match',private.match_snapshot(p_game_id));
    perform realtime.send(v_event,'combat','game:'||p_game_id::text||':combat',true);
  elsif v_room.match_state='ACTIVE' and v_room.ends_at<=clock_timestamp() then
    select gp.player_id into v_winner from public.game_players gp where gp.game_id=p_game_id
      order by gp.kills desc,gp.deaths asc,gp.player_id limit 1;
    select count(*)>1 into v_tied from public.game_players gp
      where gp.game_id=p_game_id and gp.kills=(select max(x.kills) from public.game_players x where x.game_id=p_game_id)
        and gp.deaths=(select min(x.deaths) from public.game_players x where x.game_id=p_game_id and x.kills=(select max(y.kills) from public.game_players y where y.game_id=p_game_id));
    if coalesce(v_tied,false) then v_winner:=null; end if;
    update public.rooms set match_state='FINISHED',status='FINISHED',finished_at=ends_at,
      winner_player_id=v_winner,updated_at=clock_timestamp() where id=p_game_id returning * into v_room;
    v_event:=jsonb_build_object('event_id',gen_random_uuid(),'type','match_finished','game_id',p_game_id,
      'match',private.match_snapshot(p_game_id));
    perform realtime.send(v_event,'combat','game:'||p_game_id::text||':combat',true);
  elsif v_room.match_state='FINISHED' and v_room.finished_at<=clock_timestamp()-interval '1 second' then
    update public.rooms set match_state='RESULTS',results_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=p_game_id returning * into v_room;
    v_event:=jsonb_build_object('event_id',gen_random_uuid(),'type','match_results','game_id',p_game_id,
      'match',private.match_snapshot(p_game_id));
    perform realtime.send(v_event,'combat','game:'||p_game_id::text||':combat',true);
  end if;
end;
$$;

create or replace function private.lobby_snapshot(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id',r.id,'code',r.code,'host_player_id',r.host_player_id,
    'status',r.status,'match_state',r.match_state,'countdown_ends_at',r.countdown_ends_at,
    'started_at',r.started_at,'ends_at',r.ends_at,'finished_at',r.finished_at,
    'winner_player_id',r.winner_player_id,'max_players',r.max_players,
    'players',coalesce((select jsonb_agg(jsonb_build_object('player_id',rp.player_id,'display_name',rp.display_name,
      'is_ready',rp.is_ready,'joined_at',rp.joined_at,'last_seen_at',rp.last_seen_at,'is_active',rp.is_active)
      order by rp.joined_at,rp.player_id) from public.room_players rp where rp.room_id=r.id and rp.is_active),'[]'::jsonb))
  from public.rooms r where r.id=p_room_id
$$;

create or replace function public.start_match()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_room_id uuid; v_room public.rooms%rowtype; v_event jsonb;
begin
  if v_uid is null then raise exception 'Sign in before starting a match'; end if;
  select r.id into v_room_id from public.rooms r join public.room_players rp on rp.room_id=r.id
    where rp.player_id=v_uid and rp.is_active order by rp.joined_at desc limit 1;
  if v_room_id is null then raise exception 'No active room membership'; end if;
  select * into v_room from public.rooms where id=v_room_id for update;
  if v_room.host_player_id<>v_uid then raise exception 'Only the room host can start a match'; end if;
  if v_room.match_state='LOBBY' then
    if (select count(*) from public.room_players rp where rp.room_id=v_room_id and rp.is_active)<2
       or exists(select 1 from public.room_players rp where rp.room_id=v_room_id and rp.is_active and not rp.is_ready) then
      raise exception 'At least 2 active players must all be ready';
    end if;
  elsif v_room.match_state not in ('FINISHED','RESULTS') then
    raise exception 'A match is already underway';
  end if;

  with spawns(slot,x,y,z) as (values (1,-4.0,0.0,5.0),(2,4.0,0.0,-5.0),(3,-4.0,0.0,-5.0),(4,4.0,0.0,5.0),
    (5,-12.0,2.98,0.0),(6,12.0,2.98,0.0),(7,0.0,4.6,-13.0),(8,0.0,2.425,13.0)), members as (
      select rp.player_id,rp.display_name,row_number() over(order by rp.joined_at,rp.player_id) slot
      from public.room_players rp where rp.room_id=v_room_id and rp.is_active)
  insert into public.game_players(game_id,player_id,display_name,spawn_x,spawn_y,spawn_z,position_x,position_y,position_z,
    rotation_y,velocity_y,grounded,jetpack_active,health,kills,deaths,is_alive,dead_until,last_fire_at,last_seen_at,updated_at)
  select v_room_id,m.player_id,m.display_name,s.x,s.y,s.z,s.x,s.y,s.z,atan2(s.x,s.z),0,true,false,100,0,0,true,null,null,now(),now()
    from members m join spawns s on s.slot=m.slot
  on conflict(game_id,player_id) do update set display_name=excluded.display_name,
    position_x=excluded.position_x,position_y=excluded.position_y,position_z=excluded.position_z,
    spawn_x=excluded.spawn_x,spawn_y=excluded.spawn_y,spawn_z=excluded.spawn_z,rotation_y=excluded.rotation_y,
    velocity_y=0,grounded=true,jetpack_active=false,health=100,kills=0,deaths=0,is_alive=true,
    dead_until=null,last_fire_at=null,last_seen_at=now(),updated_at=now();
  update public.room_players set is_ready=true,last_seen_at=now() where room_id=v_room_id and is_active;
  update public.rooms set status='LOBBY',match_state='COUNTDOWN',countdown_ends_at=clock_timestamp()+interval '3 seconds',
    started_at=null,ends_at=null,finished_at=null,results_at=null,winner_player_id=null,updated_at=clock_timestamp()
    where id=v_room_id;
  v_event:=jsonb_build_object('event_id',gen_random_uuid(),'type','match_countdown','game_id',v_room_id,
    'countdown_ends_at',(select countdown_ends_at from public.rooms where id=v_room_id));
  perform realtime.send(v_event,'combat','game:'||v_room_id::text||':combat',true);
  return private.lobby_snapshot(v_room_id);
end;
$$;

create or replace function public.return_to_lobby()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_room_id uuid;
begin
  select r.id into v_room_id from public.rooms r join public.room_players rp on rp.room_id=r.id
    where rp.player_id=v_uid and rp.is_active order by rp.joined_at desc limit 1;
  if v_room_id is null then raise exception 'No active room membership'; end if;
  update public.rooms set status='LOBBY',match_state='LOBBY',countdown_ends_at=null,started_at=null,
    ends_at=null,finished_at=null,results_at=null,winner_player_id=null,updated_at=now()
    where id=v_room_id and host_player_id=v_uid and match_state in ('FINISHED','RESULTS');
  if not found then raise exception 'Only the host can return a finished match to the lobby'; end if;
  update public.room_players set is_ready=false,last_seen_at=now() where room_id=v_room_id and is_active;
  return private.lobby_snapshot(v_room_id);
end;
$$;

create or replace function public.get_match_state()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid:=auth.uid(); v_room_id uuid; v_result jsonb;
begin
  select rp.room_id into v_room_id from public.room_players rp where rp.player_id=v_uid
    order by rp.joined_at desc limit 1;
  if v_room_id is null then raise exception 'No room membership'; end if;
  perform private.advance_match(v_room_id);
  v_result:=private.match_snapshot(v_room_id);
  return v_result;
end;
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
  select jsonb_build_object('game_id',v_game_id,'room_code',v_code,'player_id',v_uid,'host_player_id',v_host,
    'match',private.match_snapshot(v_game_id),
    'players',coalesce(jsonb_agg(jsonb_build_object('player_id',gp.player_id,'display_name',gp.display_name,
      'spawn_position',jsonb_build_array(gp.spawn_x,gp.spawn_y,gp.spawn_z),
      'position',jsonb_build_array(gp.position_x,gp.position_y,gp.position_z),'rotation_y',gp.rotation_y,
      'velocity_y',gp.velocity_y,'grounded',gp.grounded,'jetpack_active',gp.jetpack_active,
      'health',gp.health,'kills',gp.kills,'deaths',gp.deaths,'is_alive',gp.is_alive,'dead_until',gp.dead_until,
      'last_seen_at',gp.last_seen_at,'is_active',coalesce(rp.is_active,false))
      order by coalesce(rp.joined_at,gp.updated_at),gp.player_id),'[]'::jsonb)) into v_result
  from public.game_players gp left join public.room_players rp on rp.room_id=gp.game_id and rp.player_id=gp.player_id
  where gp.game_id=v_game_id;
  return v_result;
end;
$$;

create or replace function private.can_read_game_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_game_id uuid; v_uid uuid:=auth.uid();
begin
  if v_uid is null or split_part(p_topic,':',1)<>'game' or split_part(p_topic,':',3)<>'player' then return false; end if;
  begin v_game_id:=split_part(p_topic,':',2)::uuid; exception when invalid_text_representation then return false; end;
  return exists(select 1 from public.rooms r join public.room_players rp on rp.room_id=r.id
    where r.id=v_game_id and rp.player_id=v_uid and rp.is_active and r.match_state in ('COUNTDOWN','ACTIVE'));
end $$;
create or replace function private.can_write_game_topic(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_topic,':',4)=(select auth.uid())::text
    and private.can_read_game_topic(p_topic)
    and exists(select 1 from public.rooms r where r.id=split_part(p_topic,':',2)::uuid and r.match_state='ACTIVE')
$$;
create or replace function private.can_read_combat_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_game_id uuid; v_uid uuid:=auth.uid();
begin
  if v_uid is null or split_part(p_topic,':',1)<>'game' or split_part(p_topic,':',3)<>'combat' then return false; end if;
  begin v_game_id:=split_part(p_topic,':',2)::uuid; exception when invalid_text_representation then return false; end;
  return exists(select 1 from public.rooms r join public.room_players rp on rp.room_id=r.id
    where r.id=v_game_id and rp.player_id=v_uid and rp.is_active
      and rp.last_seen_at>now()-interval '35 seconds' and r.match_state in ('COUNTDOWN','ACTIVE','FINISHED','RESULTS'));
end $$;
revoke all on function private.can_read_game_topic(text),private.can_write_game_topic(text),private.can_read_combat_topic(text) from public,anon;
grant execute on function private.can_read_game_topic(text),private.can_write_game_topic(text),private.can_read_combat_topic(text) to authenticated;

revoke all on function public.return_to_lobby(),public.get_match_state() from public,anon;
grant execute on function public.return_to_lobby(),public.get_match_state() to authenticated;
comment on table private.match_config is 'Server-only match duration configuration. Production default is exactly 300 seconds; clients have no privileges.';

create or replace function private.expire_stale_players()
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room record; v_new_host uuid;
begin
  update public.room_players set is_active=false,is_ready=false
    where is_active and last_seen_at<now()-interval '35 seconds';
  for v_room in select r.id,r.host_player_id from public.rooms r
    where exists(select 1 from public.room_players old where old.room_id=r.id and old.player_id=r.host_player_id and not old.is_active)
  loop
    select rp.player_id into v_new_host from public.room_players rp
      where rp.room_id=v_room.id and rp.is_active order by rp.joined_at,rp.player_id limit 1;
    if v_new_host is not null then update public.rooms set host_player_id=v_new_host,updated_at=now() where id=v_room.id; end if;
  end loop;
end;
$$;

do $$
declare v_definition text; v_needle text; v_replacement text;
begin
  select pg_get_functiondef('public.request_player_shot(double precision,double precision,double precision)'::regprocedure)
    into v_definition;
  v_needle := '  select gp.* into v_shooter from public.game_players gp';
  v_replacement := '  perform private.advance_match(v_game_id);'||E'\n'
    ||'  if not exists(select 1 from public.rooms where id=v_game_id and match_state=''ACTIVE'' and ends_at>clock_timestamp()) then'||E'\n'
    ||'    return jsonb_build_object(''accepted'',false,''reason'',''match_not_active'',''events'',''[]''::jsonb);'||E'\n'
    ||'  end if;'||E'\n'||v_needle;
  if position(v_needle in v_definition)=0 then raise exception 'Could not apply active-match shot guard'; end if;
  execute replace(v_definition,v_needle,v_replacement);
end;
$$;
