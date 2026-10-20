-- Usual schedule from Discord (/raid availability), for players who never open the website. The
-- player picks days and an hourly window inside the guild's planning hours, and marks them available
-- or not; other days keep their times. Saving works like "save as usual schedule" in the app
-- (saveAvailabilityTemplate): the schedule starts from this week, or from next week once this week's
-- check-ins have closed; the schedule it replaces stays as `previous`, so a closed week keeps its
-- times; it is confirmed today and starts unpaused; the review interval carries over. Weeks the
-- player already answered keep their answers. Called only by the raid-interactions Edge Function.

-- The week a usual schedule saved now starts from.
create function public.discord_schedule_week(g uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
declare this_week date; deadline timestamptz;
begin
  select date_trunc('week', now() at time zone gu.timezone)::date into this_week from public.guilds gu where gu.id = g;
  deadline := public.checkin_deadline(g, this_week);
  return case when deadline is not null and deadline <= now() then this_week + 7 else this_week end;
end $$;

-- The player's usual times as the bot shows them, in the guild's planning grid: one half-hour cell
-- per slot, `day * slotsPerDay + slot`, days from Monday. A schedule saved under different guild
-- hours is reported as `gridChanged` with no cells rather than shifted.
create function public.discord_availability(p_discord_id text, p_discord_guild_id text, p_channel_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare who jsonb; g public.guilds; m text; from_week date; stored jsonb; current jsonb; same_grid boolean;
begin
  who := public.discord_member_for(p_discord_id, p_discord_guild_id, p_channel_id);
  if who ? 'outcome' then return who; end if;
  select * into g from public.guilds where id = (who ->> 'guildId')::uuid;
  m := who ->> 'memberId';
  from_week := public.discord_schedule_week(g.id);
  select t.template into stored from public.availability_templates t where t.guild_id = g.id and t.member_id = m;
  current := public.template_governing(stored, from_week);
  -- A schedule that has ended answers nothing, as in the app: show none and carry nothing forward.
  if public.template_ended(current, from_week) then current := null; end if;
  same_grid := coalesce(current ->> 'timezone' = g.timezone
    and (current ->> 'dayStartHour')::int = g.day_start_hour
    and (current ->> 'slotsPerDay')::int = g.slots_per_day, false);
  return jsonb_build_object('outcome', 'ok', 'guildName', g.name, 'timezone', g.timezone,
    'dayStartHour', g.day_start_hour, 'slotsPerDay', g.slots_per_day, 'week', from_week,
    'hasSchedule', current is not null, 'gridChanged', current is not null and not same_grid,
    'paused', public.template_paused(current, from_week),
    'slots', case when same_grid then current -> 'slots' else '[]'::jsonb end,
    'weekAnswered', exists (select 1 from public.checkins c
      where c.guild_id = g.id and c.week = from_week and c.member_id = m and c.checked_in));
end $$;

-- Mark `p_days` (0 = Monday) available from slot `p_from` until `p_to`, or not available at all.
-- `p_day_start_hour` and `p_slots_per_day` are the guild hours the menus were built with; if the
-- guild has changed them since, nothing is saved (stale) and the bot shows fresh menus.
--
-- Outcomes: saved (with the discord_availability fields), stale, not-member, ambiguous.
create function public.set_availability_from_discord(
  p_discord_id text, p_discord_guild_id text, p_channel_id text,
  p_days int[], p_from int, p_to int, p_available boolean, p_day_start_hour int, p_slots_per_day int
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare who jsonb; g public.guilds; m text; from_week date; stored jsonb; current jsonb; previous jsonb;
  kept jsonb := '[]'; slots jsonb; new_template jsonb;
begin
  if p_days is null or cardinality(p_days) not between 1 and 7
     or exists (select 1 from unnest(p_days) d where d is null or d not between 0 and 6)
     or (select count(distinct d) from unnest(p_days) d) <> cardinality(p_days)
     or p_available is null or p_day_start_hour is null or p_slots_per_day is null
     or (p_available and (p_from is null or p_to is null or p_from < 0 or p_to <= p_from or p_to > p_slots_per_day)) then
    raise exception 'Invalid availability.' using errcode = '22023';
  end if;
  who := public.discord_member_for(p_discord_id, p_discord_guild_id, p_channel_id);
  if who ? 'outcome' then return who; end if;
  -- Same lock order as atomic saves: an app saving meanwhile reloads instead of overwriting this.
  perform 1 from public.guild_revisions r where r.guild_id = (who ->> 'guildId')::uuid for update;
  select * into g from public.guilds where id = (who ->> 'guildId')::uuid;
  m := who ->> 'memberId';
  if g.day_start_hour <> p_day_start_hour or g.slots_per_day <> p_slots_per_day then
    return jsonb_build_object('outcome', 'stale');
  end if;

  from_week := public.discord_schedule_week(g.id);
  select t.template into stored from public.availability_templates t where t.guild_id = g.id and t.member_id = m;
  current := public.template_governing(stored, from_week);
  -- A schedule that has ended answers nothing, as in the app: show none and carry nothing forward.
  if public.template_ended(current, from_week) then current := null; end if;
  -- Other days keep their times, when the schedule uses the guild's current hours.
  if current ->> 'timezone' = g.timezone and (current ->> 'dayStartHour')::int = g.day_start_hour
     and (current ->> 'slotsPerDay')::int = g.slots_per_day then
    select coalesce(jsonb_agg(s), '[]') into kept from jsonb_array_elements(current -> 'slots') s
      where not ((s #>> '{}')::int / g.slots_per_day = any (p_days));
  end if;
  select coalesce(jsonb_agg(cell order by cell), '[]') into slots from (
    select (s #>> '{}')::int as cell from jsonb_array_elements(kept) s
    union
    select d * g.slots_per_day + x from unnest(p_days) d, generate_series(p_from, p_to - 1) x where p_available
  ) cells;
  -- The schedule this replaces still governs the weeks before, as in saveAvailabilityTemplate.
  previous := public.template_governing(stored, from_week - 7);
  new_template := jsonb_build_object('timezone', g.timezone, 'fromWeek', from_week, 'dayStartHour', g.day_start_hour,
      'slotsPerDay', g.slots_per_day, 'slots', slots, 'confirmedAt', (now() at time zone g.timezone)::date)
    || case when current ? 'reviewWeeks' then jsonb_build_object('reviewWeeks', current -> 'reviewWeeks') else '{}' end
    || case when previous is not null then jsonb_build_object('previous', previous) else '{}' end;
  insert into public.availability_templates (guild_id, member_id, template) values (g.id, m, new_template)
  on conflict (guild_id, member_id) do update set template = excluded.template;
  update public.guild_revisions set revision = revision + 1 where guild_id = g.id;
  return public.discord_availability(p_discord_id, p_discord_guild_id, p_channel_id)
    || jsonb_build_object('outcome', 'saved');
end $$;

revoke execute on function public.discord_schedule_week(uuid),
  public.discord_availability(text, text, text),
  public.set_availability_from_discord(text, text, text, int[], int, int, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.discord_availability(text, text, text),
  public.set_availability_from_discord(text, text, text, int[], int, int, boolean, int, int) to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261105120000'::text $$;
