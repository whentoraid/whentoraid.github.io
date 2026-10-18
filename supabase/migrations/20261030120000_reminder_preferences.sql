-- Member reminder preferences (M06). Reminders stay in the guild's shared Discord channel; a player's
-- preference only decides whether a reminder pings them or names them without a notification. Quiet
-- hours are kept in the player's own timezone, so a reminder sent overnight for them is silent.
-- Roster announcements are not affected. The table is reached only through the functions below.

create table public.member_reminder_prefs (
  guild_id uuid not null,
  member_id text not null,
  ping boolean not null default true,
  -- Minutes after local midnight; both null means no quiet hours. A window may wrap past midnight.
  quiet_start int check (quiet_start between 0 and 1439),
  quiet_end int check (quiet_end between 0 and 1439),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  updated_at timestamptz not null default now(),
  primary key (guild_id, member_id),
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade,
  check ((quiet_start is null) = (quiet_end is null)),
  check (quiet_start is distinct from quiet_end or quiet_start is null)
);
alter table public.member_reminder_prefs enable row level security;
revoke all on public.member_reminder_prefs from public, anon, authenticated;

-- Whether a reminder sent at `sent_at` may ping this member. No saved preference means yes.
create function public.reminder_pings(g uuid, m text, sent_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select pr.ping and (pr.quiet_start is null or not case
      when pr.quiet_start < pr.quiet_end then l.minute >= pr.quiet_start and l.minute < pr.quiet_end
      else l.minute >= pr.quiet_start or l.minute < pr.quiet_end end)
    from public.member_reminder_prefs pr,
      lateral (select (extract(hour from sent_at at time zone pr.timezone) * 60
        + extract(minute from sent_at at time zone pr.timezone))::int as minute) l
    where pr.guild_id = g and pr.member_id = m), true)
$$;

-- The signed-in player's own preferences, with the defaults when none are saved.
create function public.get_my_reminder_prefs(p_guild_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m text := public.my_member_id(p_guild_id); pr public.member_reminder_prefs;
begin
  if m is null then raise exception 'Sign in as a member of this guild.' using errcode = '42501'; end if;
  select * into pr from public.member_reminder_prefs where guild_id = p_guild_id and member_id = m;
  return jsonb_build_object('ping', coalesce(pr.ping, true), 'quiet_start', pr.quiet_start,
    'quiet_end', pr.quiet_end, 'timezone', pr.timezone);
end $$;

create function public.set_my_reminder_prefs(
  p_guild_id uuid, p_ping boolean, p_quiet_start int, p_quiet_end int, p_timezone text
) returns void language plpgsql security definer set search_path = '' as $$
declare m text := public.my_member_id(p_guild_id);
begin
  if m is null then raise exception 'Sign in as a member of this guild.' using errcode = '42501'; end if;
  if (p_quiet_start is null) <> (p_quiet_end is null) then
    raise exception 'Choose when quiet hours start and end.' using errcode = '22023';
  end if;
  if p_quiet_start is not null and (p_quiet_start not between 0 and 1439 or p_quiet_end not between 0 and 1439) then
    raise exception 'Choose quiet hours within a day.' using errcode = '22023';
  end if;
  if p_quiet_start is not null and p_quiet_start = p_quiet_end then
    raise exception 'Quiet hours need to end at a different time than they start.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a known timezone.' using errcode = '22023';
  end if;
  insert into public.member_reminder_prefs (guild_id, member_id, ping, quiet_start, quiet_end, timezone, updated_at)
    values (p_guild_id, m, coalesce(p_ping, true), p_quiet_start, p_quiet_end, p_timezone, now())
  on conflict (guild_id, member_id) do update set ping = excluded.ping, quiet_start = excluded.quiet_start,
    quiet_end = excluded.quiet_end, timezone = excluded.timezone, updated_at = now();
end $$;

-- As in 20261024120000, with each recipient's `mention`: whether this reminder may ping them now.
create or replace function public.raid_reminder_payload(p_id uuid,p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.discord_deliveries; s public.raid_reminder_settings; p public.plans; recipients jsonb; deadline timestamptz;
begin
  select * into d from public.discord_deliveries where id=p_id and lease_token=p_lease and status='sending';
  if not found then return null; end if;
  select * into s from public.raid_reminder_settings where guild_id=d.guild_id;
  if d.kind='checkin' then
    deadline:=public.checkin_deadline(d.guild_id,d.week);
    if not coalesce(s.checkin_enabled,false) or (deadline is not null and deadline<=now()) then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object('name',m.name,'discordId',m.discord_id,
        'mention',public.reminder_pings(d.guild_id,m.id,now()))),'[]') into recipients
      from public.members m
      left join public.checkins c on c.guild_id=d.guild_id and c.week=d.week and c.member_id=m.id
      left join public.availability_templates t on t.guild_id=d.guild_id and t.member_id=m.id
      where m.guild_id=d.guild_id
        and not (case when c.member_id is not null then c.checked_in
                      else public.template_answers_week(t.template,d.week) end);
    return jsonb_build_object('kind','checkin','week',d.week,'recipients',recipients);
  end if;
  select * into p from public.plans where guild_id=d.guild_id and week=d.week and raid_id=d.raid_id;
  if not coalesce(s.upcoming_enabled,false) or p.published is null or p.cancelled or (p.published->>'start')::numeric<=extract(epoch from now())*1000 then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',m.name,'discordId',m.discord_id,
      'mention',public.reminder_pings(d.guild_id,m.id,now()))),'[]') into recipients
    from jsonb_array_elements(p.published->'team') e join public.members m on m.guild_id=d.guild_id and m.id=e->>'memberId'
    left join public.raid_responses r on r.guild_id=d.guild_id and r.week=d.week and r.raid_id=d.raid_id and r.member_id=m.id
      and r.assignment=public.raid_assignment(p.published,m.id)
    where r.status is distinct from 'unavailable' and (not s.only_unconfirmed or r.status is distinct from 'confirmed');
  return jsonb_build_object('kind','upcoming','raidName',p.published->>'raidName','start',p.published->'start','recipients',recipients);
end $$;

revoke execute on function public.reminder_pings(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.get_my_reminder_prefs(uuid),
  public.set_my_reminder_prefs(uuid, boolean, int, int, text) from public, anon;
grant execute on function public.get_my_reminder_prefs(uuid),
  public.set_my_reminder_prefs(uuid, boolean, int, int, text) to authenticated;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261030120000'::text $$;
