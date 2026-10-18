-- A Confirm press by a player outside the published team offers them as standby.
-- It never adds a published slot or records a roster confirmation for them.
drop function public.respond_to_discord_raid(text,text,text,text,text,uuid,bigint,text);
create function public.respond_to_discord_raid(
  p_interaction_id text, p_discord_id text, p_discord_guild_id text, p_channel_id text,
  p_message_id text, p_delivery_id uuid, p_version bigint, p_status text,
  p_character_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.discord_deliveries; g public.guilds; hook public.guild_discord; m public.members;
  p public.plans; current_assignment text; chosen public.characters; active_count int;
begin
  if p_interaction_id !~ '^\d{17,20}$' or p_discord_id !~ '^\d{17,20}$'
     or p_discord_guild_id !~ '^\d{17,20}$' or p_channel_id !~ '^\d{17,20}$'
     or p_message_id !~ '^\d{17,20}$' or p_status is null
     or p_status not in ('confirmed','tentative','unavailable')
     or (p_character_id is not null and char_length(p_character_id) not between 1 and 64) then
    raise exception 'Invalid Discord response.' using errcode = '22023';
  end if;
  select * into d from public.discord_deliveries where id = p_delivery_id and kind = 'roster';
  if not found then return jsonb_build_object('outcome','unknown'); end if;
  select * into g from public.guilds where id = d.guild_id;
  select * into hook from public.guild_discord where guild_id = d.guild_id;
  if g.discord_server_id is distinct from p_discord_guild_id or hook.channel_id is distinct from p_channel_id
     or d.webhook_fingerprint <> md5('bot:' || p_channel_id) or not (d.message_ids ? p_message_id) then
    return jsonb_build_object('outcome','unknown');
  end if;
  if d.version <> p_version then return jsonb_build_object('outcome','stale'); end if;
  select * into m from public.members where guild_id = d.guild_id and discord_id = p_discord_id;
  if not found then return jsonb_build_object('outcome','not-member','guildId',d.guild_id); end if;
  select * into p from public.plans where guild_id = d.guild_id and week = d.week and raid_id = d.raid_id for share;
  if p.published is null or p.cancelled or (p.published ->> 'start')::numeric <= extract(epoch from now()) * 1000 then
    return jsonb_build_object('outcome','closed');
  end if;
  current_assignment := public.raid_assignment(p.published, m.id);
  if current_assignment is null then
    if p_status <> 'confirmed' then return jsonb_build_object('outcome','not-rostered'); end if;
    select count(*) into active_count from public.characters c
      where c.guild_id = d.guild_id and c.member_id = m.id and not c.retired;
    if active_count = 0 then return jsonb_build_object('outcome','no-characters','guildId',d.guild_id); end if;
    if p_character_id is null and active_count > 1 then
      return jsonb_build_object('outcome','choose','characters',(
        select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'class',c.class,'spec',c.spec,'role',c.role)
          order by c.main desc,c.position)
        from (select * from public.characters where guild_id=d.guild_id and member_id=m.id and not retired
          order by main desc,position limit 25) c));
    end if;
    select * into chosen from public.characters c where c.guild_id=d.guild_id and c.member_id=m.id
      and not c.retired and (p_character_id is null or c.id=p_character_id) limit 1;
    if not found then return jsonb_build_object('outcome','bad-character'); end if;
  elsif p_character_id is not null then
    return jsonb_build_object('outcome','bad-character');
  end if;
  delete from public.discord_interactions where received_at < now() - interval '1 day';
  insert into public.discord_interactions(id) values(p_interaction_id) on conflict(id) do nothing;
  if not found then return jsonb_build_object('outcome','duplicate'); end if;
  if current_assignment is null then
    insert into public.raid_standby(guild_id,week,raid_id,member_id,character_id,until_ms,updated_at)
      values(d.guild_id,d.week,d.raid_id,m.id,chosen.id,null,now())
    on conflict(guild_id,week,raid_id,member_id) do update set character_id=excluded.character_id,
      until_ms=null,updated_at=now();
    update public.discord_deliveries set
      status=case when status='sent' then 'pending' else status end,
      payload=case when status='sending' then jsonb_set(payload,'{refreshRequested}','true') else payload end,
      next_attempt_at=now(),updated_at=now()
      where id=d.id and status in ('sent','sending');
    return jsonb_build_object('outcome','standby','raidName',p.published->>'raidName',
      'character',chosen.name,'guildId',d.guild_id);
  end if;
  insert into public.raid_responses(guild_id,week,raid_id,member_id,publication,assignment,status,note,updated_at)
    values(d.guild_id,d.week,d.raid_id,m.id,p.published->>'publishedAt',current_assignment,p_status,'',now())
  on conflict(guild_id,week,raid_id,member_id) do update set publication=excluded.publication,
    note=case when raid_responses.assignment=excluded.assignment then raid_responses.note else '' end,
    assignment=excluded.assignment,status=excluded.status,updated_at=excluded.updated_at;
  update public.discord_deliveries set
    status=case when status='sent' then 'pending' else status end,
    payload=case when status='sending' then jsonb_set(payload,'{refreshRequested}','true') else payload end,
    next_attempt_at=now(),updated_at=now()
    where id=d.id and status in ('sent','sending');
  return jsonb_build_object('outcome','saved','status',p_status,'raidName',p.published->>'raidName',
    'guildId',d.guild_id);
end $$;
revoke execute on function public.respond_to_discord_raid(text,text,text,text,text,uuid,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.respond_to_discord_raid(text,text,text,text,text,uuid,bigint,text,text)
  to service_role;

-- If a response arrives during a send, deliver the newer marker immediately after that send.
create or replace function public.finish_discord_delivery(p_id uuid,p_lease uuid,p_version bigint,
  p_error text default null,p_uncertain boolean default false,p_retry_seconds int default 0) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.discord_deliveries set
    status=case when p_uncertain then 'uncertain' when version<>p_version then 'pending'
      when p_error is null and payload->>'refreshRequested'='true' then 'pending'
      when p_error is null then 'sent' when attempts>=5 then 'failed' else 'pending' end,
    payload=payload-'refreshRequested',last_error=left(p_error,500),lease_token=null,lease_until=null,
    updated_at=now(),
    next_attempt_at=case when p_error is null and not p_uncertain then now()
      else now()+make_interval(secs=>greatest(least(coalesce(p_retry_seconds,0),86400),
        least(3600,(30*power(2,attempts))::int))) end
  where id=p_id and lease_token=p_lease and status='sending';
end $$;

-- Resolve statuses and standby from current rows at send time so the same post updates after a press.
create function public.raid_roster_live_payload(p_id uuid,p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.discord_deliveries; p public.plans; base jsonb; team jsonb; standby jsonb;
begin
  select * into d from public.discord_deliveries where id=p_id and lease_token=p_lease
    and status='sending' and kind='roster';
  if not found then return null; end if;
  if d.payload->>'cancelled'='true' or d.payload->>'withdrawn'='true' then return d.payload; end if;
  select * into p from public.plans where guild_id=d.guild_id and week=d.week and raid_id=d.raid_id;
  if p.published is null or p.cancelled then return d.payload; end if;
  base := public.raid_delivery_payload(d.guild_id,d.week,d.raid_id,p.published,false,false);
  select coalesce(jsonb_agg(e.value || jsonb_build_object('response',resp.status) order by e.ordinality),'[]') into team
    from jsonb_array_elements(base->'team') with ordinality e(value,ordinality)
    left join jsonb_array_elements(p.published->'team') with ordinality original(entry,position)
      on original.position=e.ordinality
    left join public.raid_responses resp on resp.guild_id=d.guild_id and resp.week=d.week
      and resp.raid_id=d.raid_id and resp.member_id=original.entry->>'memberId'
      and resp.assignment=public.raid_assignment(p.published,original.entry->>'memberId');
  select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(c.name,m.name),'player',m.name,
      'class',c.class,'spec',c.spec,'role',c.role,'discordId',m.discord_id) order by s.updated_at),'[]') into standby
    from public.raid_standby s join public.members m on m.guild_id=s.guild_id and m.id=s.member_id
    left join public.characters c on c.guild_id=s.guild_id and c.id=s.character_id
    where s.guild_id=d.guild_id and s.week=d.week and s.raid_id=d.raid_id
      and (s.until_ms is null or s.until_ms > extract(epoch from now())*1000)
      and not public.in_published_team(p,s.member_id);
  return base || jsonb_build_object('team',team,'standby',standby);
end $$;
revoke execute on function public.raid_roster_live_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.raid_roster_live_payload(uuid,uuid) to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261029120000'::text $$;
