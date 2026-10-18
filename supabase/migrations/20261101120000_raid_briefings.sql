-- Raid-day briefing (M15). Officers can add logistics to a raid profile (meet-up lead time, location,
-- voice link, contact, preparation notes) and a short note for one week. Everything is optional and
-- never changes a roster or confirmation rule. Members read it in the app; the Discord roster post
-- carries a summary. The tables are reached only through the functions below.

create table public.raid_briefings (
  guild_id uuid not null references public.guilds on delete cascade,
  raid_id text not null check (raid_id ~ '^[a-z0-9-]{1,64}$'),
  -- Minutes before the raid start that players should be in place.
  assembly_minutes int check (assembly_minutes between 0 and 120),
  location text not null default '' check (char_length(location) <= 120),
  -- https only, without characters that would break a Discord masked link.
  voice_url text not null default '' check (voice_url = ''
    or (char_length(voice_url) <= 300 and voice_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>"()\[\]]*)?$')),
  contact text not null default '' check (char_length(contact) <= 80),
  notes text not null default '' check (char_length(notes) <= 500),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (guild_id, raid_id)
);
alter table public.raid_briefings enable row level security;
revoke all on public.raid_briefings from public, anon, authenticated;

create table public.raid_week_notes (
  guild_id uuid not null references public.guilds on delete cascade,
  week date not null check (extract(isodow from week) = 1),
  raid_id text not null check (raid_id ~ '^[a-z0-9-]{1,64}$'),
  note text not null check (char_length(btrim(note)) between 1 and 300),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (guild_id, week, raid_id)
);
alter table public.raid_week_notes enable row level security;
revoke all on public.raid_week_notes from public, anon, authenticated;

-- One raid's briefing for one week, with empty fields left out; null when there is nothing to say.
create function public.raid_briefing_json(g uuid, w date, r text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
      'assemblyMinutes', b.assembly_minutes, 'location', nullif(b.location, ''),
      'voiceUrl', nullif(b.voice_url, ''), 'contact', nullif(b.contact, ''), 'notes', nullif(b.notes, ''),
      'weekNote', n.note)), '{}'::jsonb)
  from (select 1) one
  left join public.raid_briefings b on b.guild_id = g and b.raid_id = r
  left join public.raid_week_notes n on n.guild_id = g and n.week = w and n.raid_id = r
$$;

-- Edit the guild's posted rosters for raids that have not started, so Discord shows the new briefing.
create function public.refresh_roster_posts(g uuid, r text, w date default null) returns void
language sql security definer set search_path = '' as $$
  update public.discord_deliveries d set
    status = case when d.status = 'sent' then 'pending' else d.status end,
    payload = case when d.status = 'sending' then jsonb_set(d.payload, '{refreshRequested}', 'true') else d.payload end,
    next_attempt_at = now(), updated_at = now()
  where d.guild_id = g and d.raid_id = r and d.kind = 'roster' and d.action = 'post'
    and d.status in ('sent', 'sending') and (w is null or d.week = w)
    and exists (select 1 from public.plans p where p.guild_id = g and p.week = d.week and p.raid_id = r
      and p.published is not null and not p.cancelled
      and (p.published->>'start')::numeric > extract(epoch from now()) * 1000)
$$;

-- Every raid profile's briefing, and the week notes from last week on.
create function public.get_raid_briefings(p_guild_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_member(p_guild_id) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'raids', coalesce((select jsonb_object_agg(b.raid_id, jsonb_strip_nulls(jsonb_build_object(
        'assemblyMinutes', b.assembly_minutes, 'location', b.location, 'voiceUrl', b.voice_url,
        'contact', b.contact, 'notes', b.notes)))
      from public.raid_briefings b where b.guild_id = p_guild_id), '{}'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('week', n.week, 'raidId', n.raid_id, 'note', n.note)
        order by n.week, n.raid_id)
      from public.raid_week_notes n where n.guild_id = p_guild_id
        and n.week >= date_trunc('week', now() at time zone 'UTC')::date - 7), '[]'::jsonb));
end $$;

create function public.set_raid_briefing(p_guild_id uuid, p_raid_id text, p_assembly_minutes int,
  p_location text, p_voice_url text, p_contact text, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  officer text := public.my_member_id(p_guild_id);
  loc text := btrim(coalesce(p_location, ''));
  voice text := btrim(coalesce(p_voice_url, ''));
  who text := btrim(coalesce(p_contact, ''));
  prep text := btrim(coalesce(p_notes, ''));
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can change the raid briefing.' using errcode = '42501';
  end if;
  if coalesce(p_raid_id, '') !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'Choose a raid.' using errcode = '22023';
  end if;
  if p_assembly_minutes is not null and p_assembly_minutes not between 0 and 120 then
    raise exception 'Meet up between 0 and 120 minutes before the start.' using errcode = '22023';
  end if;
  if char_length(loc) > 120 or char_length(who) > 80 or char_length(prep) > 500 then
    raise exception 'Keep the location to 120 characters, the contact to 80 and the notes to 500.' using errcode = '22023';
  end if;
  if voice <> '' and (char_length(voice) > 300
      or voice !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>"()\[\]]*)?$') then
    raise exception 'The voice link must be a web address starting with https://.' using errcode = '22023';
  end if;
  if p_assembly_minutes is null and loc = '' and voice = '' and who = '' and prep = '' then
    delete from public.raid_briefings where guild_id = p_guild_id and raid_id = p_raid_id;
  else
    insert into public.raid_briefings (guild_id, raid_id, assembly_minutes, location, voice_url, contact,
        notes, updated_by, updated_at)
      values (p_guild_id, p_raid_id, p_assembly_minutes, loc, voice, who, prep, officer, now())
    on conflict (guild_id, raid_id) do update set assembly_minutes = excluded.assembly_minutes,
      location = excluded.location, voice_url = excluded.voice_url, contact = excluded.contact,
      notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  perform public.refresh_roster_posts(p_guild_id, p_raid_id);
end $$;

create function public.set_raid_week_note(p_guild_id uuid, p_week date, p_raid_id text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare officer text := public.my_member_id(p_guild_id); body text := btrim(coalesce(p_note, ''));
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can change the raid briefing.' using errcode = '42501';
  end if;
  if p_week is null or extract(isodow from p_week) <> 1 or coalesce(p_raid_id, '') !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'Choose a raid week.' using errcode = '22023';
  end if;
  if char_length(body) > 300 then
    raise exception 'Keep this week''s note to 300 characters.' using errcode = '22023';
  end if;
  if body = '' then
    delete from public.raid_week_notes where guild_id = p_guild_id and week = p_week and raid_id = p_raid_id;
  else
    insert into public.raid_week_notes (guild_id, week, raid_id, note, updated_by, updated_at)
      values (p_guild_id, p_week, p_raid_id, body, officer, now())
    on conflict (guild_id, week, raid_id) do update set note = excluded.note,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  perform public.refresh_roster_posts(p_guild_id, p_raid_id, p_week);
end $$;

-- As in 20261029120000, plus the briefing summary.
create or replace function public.raid_roster_live_payload(p_id uuid,p_lease uuid) returns jsonb
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
  return base || jsonb_build_object('team',team,'standby',standby,
    'briefing',public.raid_briefing_json(d.guild_id,d.week,d.raid_id));
end $$;
revoke execute on function public.raid_roster_live_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.raid_roster_live_payload(uuid,uuid) to service_role;

revoke execute on function public.raid_briefing_json(uuid, date, text),
  public.refresh_roster_posts(uuid, text, date) from public, anon, authenticated;
revoke execute on function public.get_raid_briefings(uuid),
  public.set_raid_briefing(uuid, text, int, text, text, text, text),
  public.set_raid_week_note(uuid, date, text, text) from public, anon;
grant execute on function public.get_raid_briefings(uuid),
  public.set_raid_briefing(uuid, text, int, text, text, text, text),
  public.set_raid_week_note(uuid, date, text, text) to authenticated;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261101120000'::text $$;
