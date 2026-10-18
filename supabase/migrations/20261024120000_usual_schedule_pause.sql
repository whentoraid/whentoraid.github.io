-- Usual schedules can pause, end, and be reviewed (M11), and check-in reminders now count a usual
-- schedule as an answer, as the app always has.
--
-- A template (and the `previous` schedule it replaced) may carry:
--   pausedFrom / pausedUntil  Mondays: weeks from pausedFrom, before pausedUntil (or with no end),
--                             count as away. Their times stay saved.
--   endWeek                   Monday: the last week the schedule fills in. Later weeks are unanswered.
--   confirmedAt               date the member last said the schedule is right.
--   reviewWeeks               how often the member wants to be asked again.
-- None of these change the times a covered week gets, so template_for_week leaves them out: the
-- closed-week check compares only what a week receives. Mirrors src/lib/availability-template.js.

create or replace function public.valid_availability_template(t jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if jsonb_typeof(t) is distinct from 'object'
    or jsonb_typeof(t -> 'timezone') is distinct from 'string'
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = t ->> 'timezone')
    or jsonb_typeof(t -> 'fromWeek') is distinct from 'string'
    or extract(isodow from (t ->> 'fromWeek')::date) <> 1
    or jsonb_typeof(t -> 'dayStartHour') is distinct from 'number'
    or (t ->> 'dayStartHour')::numeric not between 0 and 23
    or (t ->> 'dayStartHour')::numeric <> trunc((t ->> 'dayStartHour')::numeric)
    or jsonb_typeof(t -> 'slotsPerDay') is distinct from 'number'
    or (t ->> 'slotsPerDay')::numeric not between 1 and 48
    or (t ->> 'slotsPerDay')::numeric <> trunc((t ->> 'slotsPerDay')::numeric)
    or jsonb_typeof(t -> 'slots') is distinct from 'array' then return false; end if;
  -- Pause, end and review details: optional, but well formed when present.
  if (t ? 'pausedFrom' and (jsonb_typeof(t -> 'pausedFrom') is distinct from 'string'
        or extract(isodow from (t ->> 'pausedFrom')::date) <> 1))
    or (t ? 'pausedUntil' and (not t ? 'pausedFrom'
        or jsonb_typeof(t -> 'pausedUntil') is distinct from 'string'
        or extract(isodow from (t ->> 'pausedUntil')::date) <> 1
        or (t ->> 'pausedUntil')::date <= (t ->> 'pausedFrom')::date))
    or (t ? 'endWeek' and (jsonb_typeof(t -> 'endWeek') is distinct from 'string'
        or extract(isodow from (t ->> 'endWeek')::date) <> 1
        or (t ->> 'endWeek')::date < (t ->> 'fromWeek')::date))
    or (t ? 'confirmedAt' and (jsonb_typeof(t -> 'confirmedAt') is distinct from 'string'
        or (t ->> 'confirmedAt')::date is null))
    or (t ? 'reviewWeeks' and (jsonb_typeof(t -> 'reviewWeeks') is distinct from 'number'
        or (t ->> 'reviewWeeks')::numeric not between 1 and 52
        or (t ->> 'reviewWeeks')::numeric <> trunc((t ->> 'reviewWeeks')::numeric))) then return false; end if;
  if t ? 'previous' and (
    jsonb_typeof(t -> 'previous') is distinct from 'object'
    or t -> 'previous' ? 'previous'
    or not public.valid_availability_template(t -> 'previous')
    or (t #>> '{previous,fromWeek}')::date >= (t ->> 'fromWeek')::date
  ) then return false; end if;
  return jsonb_array_length(t -> 'slots') <= 336 and not exists (
    select 1 from jsonb_array_elements(t -> 'slots') s
    where jsonb_typeof(s) is distinct from 'number'
      or (s #>> '{}')::numeric < 0
      or (s #>> '{}')::numeric >= 7 * (t ->> 'slotsPerDay')::numeric
      or (s #>> '{}')::numeric <> trunc((s #>> '{}')::numeric)
  );
exception when others then return false;
end $$;

-- The stored schedule governing week `w`: the template from its fromWeek on, else the one it replaced.
create function public.template_governing(t jsonb, w date) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when t is null then null
    when (t ->> 'fromWeek')::date <= w then t - 'previous'
    when jsonb_typeof(t -> 'previous') = 'object' and (t #>> '{previous,fromWeek}')::date <= w
      then t -> 'previous'
  end
$$;

create function public.template_paused(s jsonb, w date) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(s ? 'pausedFrom' and (s ->> 'pausedFrom')::date <= w
    and (not s ? 'pausedUntil' or (s ->> 'pausedUntil')::date > w), false)
$$;

create function public.template_ended(s jsonb, w date) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(s ? 'endWeek' and (s ->> 'endWeek')::date < w, false)
$$;

-- The times that fill in week `w`, without pause and review details; null when no schedule governs
-- the week, it is paused, or it has ended. Mirrors templateFor.
create or replace function public.template_for_week(t jsonb, w date) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when g is null or public.template_ended(g, w) or public.template_paused(g, w) then null
    else g - array['pausedFrom', 'pausedUntil', 'endWeek', 'confirmedAt', 'reviewWeeks']
  end
  from (select public.template_governing(t, w) as g) governing
$$;

-- Whether the schedule answers week `w`: with times, or as away while paused. Mirrors templateAnswers.
create function public.template_answers_week(t jsonb, w date) returns boolean
language sql immutable set search_path = '' as $$
  select g is not null and not public.template_ended(g, w)
  from (select public.template_governing(t, w) as g) governing
$$;

-- Resolve reminder recipients at send time, so late check-ins and cancellations suppress old nudges.
-- A saved check-in answers its week; without one, the member's usual schedule does (getCheckin).
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
    select coalesce(jsonb_agg(jsonb_build_object('name',m.name,'discordId',m.discord_id)),'[]') into recipients
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
  select coalesce(jsonb_agg(jsonb_build_object('name',m.name,'discordId',m.discord_id)),'[]') into recipients
    from jsonb_array_elements(p.published->'team') e join public.members m on m.guild_id=d.guild_id and m.id=e->>'memberId'
    left join public.raid_responses r on r.guild_id=d.guild_id and r.week=d.week and r.raid_id=d.raid_id and r.member_id=m.id
      and r.assignment=public.raid_assignment(p.published,m.id)
    where r.status is distinct from 'unavailable' and (not s.only_unconfirmed or r.status is distinct from 'confirmed');
  return jsonb_build_object('kind','upcoming','raidName',p.published->>'raidName','start',p.published->'start','recipients',recipients);
end $$;

revoke execute on function public.template_governing(jsonb, date), public.template_paused(jsonb, date),
  public.template_ended(jsonb, date), public.template_answers_week(jsonb, date) from public, anon;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261024120000'::text $$;
