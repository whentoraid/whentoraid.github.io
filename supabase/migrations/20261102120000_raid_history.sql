-- Raid history (M13). Every change to a raid plan is recorded with who made it and when: the draft
-- roster and time, publishing and withdrawing, cancelling, and attendance. Officers may add a short
-- reason. Draft and attendance activity is for officers; publications, withdrawals and cancellations
-- are also shown to the players they affect. Roster entries keep the roster from before the change so
-- officers can restore it as a new draft (in the app; publishing stays a separate step). The table
-- is written only by the trigger and reached only through the functions below.

create table public.raid_history (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds on delete cascade,
  week date not null,
  raid_id text not null,
  at timestamptz not null default now(),
  -- Kept as text so the record survives the officer leaving; null for server work such as Discord.
  actor_member_id text,
  actor_name text,
  kind text not null check (kind in ('draft', 'published', 'withdrawn', 'cancelled', 'uncancelled',
    'attendance', 'removed')),
  visibility text not null check (visibility in ('officers', 'members')),
  -- Members whose place the change concerns.
  affects text[] not null default '{}',
  details jsonb not null default '{}',
  -- The roster before the change ({ start, team, locked }), for restoring; null when there was none.
  before jsonb,
  reason text check (reason is null or char_length(reason) <= 300)
);
alter table public.raid_history enable row level security;
revoke all on public.raid_history from public, anon, authenticated;
create index raid_history_raid on public.raid_history (guild_id, week, raid_id, at desc);

-- Who joined, left, or changed character or role between two rosters.
create function public.roster_diff(old_team jsonb, new_team jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with o as (select e from jsonb_array_elements(coalesce(old_team, '[]')) e),
       n as (select e from jsonb_array_elements(coalesce(new_team, '[]')) e)
  select jsonb_build_object(
    'added', coalesce((select jsonb_agg(n.e) from n
      where not exists (select 1 from o where o.e->>'memberId' = n.e->>'memberId')), '[]'),
    'removed', coalesce((select jsonb_agg(o.e) from o
      where not exists (select 1 from n where n.e->>'memberId' = o.e->>'memberId')), '[]'),
    'changed', coalesce((select jsonb_agg(jsonb_build_object('from', o.e, 'to', n.e)) from o
      join n on n.e->>'memberId' = o.e->>'memberId'
      where o.e->>'characterId' is distinct from n.e->>'characterId' or o.e->>'role' is distinct from n.e->>'role'), '[]'))
$$;

create function public.roster_members(diff jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m), '{}') from (
    select e->>'memberId' m from jsonb_array_elements(diff->'added') e
    union all select e->>'memberId' from jsonb_array_elements(diff->'removed') e
    union all select e->'to'->>'memberId' from jsonb_array_elements(diff->'changed') e) ids
$$;

create function public.team_members(variadic teams jsonb[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct e->>'memberId'), '{}')
  from unnest(teams) t, jsonb_array_elements(coalesce(t, '[]')) e
$$;

create function public.record_raid_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g uuid := coalesce(new.guild_id, old.guild_id);
  actor text := public.my_member_id(g);
  actor_label text;
  diff jsonb;
  recent public.raid_history;
  old_pub jsonb := case when tg_op = 'INSERT' then null else old.published end;
  new_pub jsonb := case when tg_op = 'DELETE' then null else new.published end;
  changes jsonb;
begin
  -- A deleted guild takes its history with it.
  if not exists (select 1 from public.guilds where id = g) then return null; end if;
  select name into actor_label from public.members where guild_id = g and id = actor;

  if tg_op = 'DELETE' then
    -- Old weeks are not pruned online, so a deletion is an officer clearing a raid.
    if jsonb_array_length(old.team) > 0 or old.published is not null then
      insert into public.raid_history (guild_id, week, raid_id, actor_member_id, actor_name, kind, visibility,
          affects, details, before)
        values (g, old.week, old.raid_id, actor, actor_label, 'removed', 'officers',
          public.team_members(old.team), '{}',
          jsonb_build_object('start', old.start, 'team', old.team, 'locked', old.locked));
    end if;
    return null;
  end if;

  -- The draft roster or its time.
  if tg_op = 'INSERT' and jsonb_array_length(new.team) > 0
     or tg_op = 'UPDATE' and (old.team is distinct from new.team or old.start is distinct from new.start) then
    -- One officer's edits in a short burst read as one change, measured from before the first.
    select * into recent from public.raid_history
      where guild_id = g and week = new.week and raid_id = new.raid_id and kind = 'draft'
        and actor_member_id is not distinct from actor and reason is null and at > now() - interval '10 minutes'
      order by at desc limit 1;
    if found then
      diff := public.roster_diff(recent.before->'team', new.team);
      if public.roster_members(diff) = '{}' and (recent.before->>'start')::numeric = new.start then
        delete from public.raid_history where id = recent.id;
      else
        update public.raid_history set at = now(), affects = public.roster_members(diff),
            details = jsonb_build_object('roster', diff, 'fromStart', recent.before->'start', 'toStart', new.start)
          where id = recent.id;
      end if;
    else
      diff := public.roster_diff(case when tg_op = 'UPDATE' then old.team end, new.team);
      insert into public.raid_history (guild_id, week, raid_id, actor_member_id, actor_name, kind, visibility,
          affects, details, before)
        values (g, new.week, new.raid_id, actor, actor_label, 'draft', 'officers', public.roster_members(diff),
          jsonb_build_object('roster', diff, 'fromStart', case when tg_op = 'UPDATE' then old.start end,
            'toStart', new.start),
          case when tg_op = 'UPDATE' then jsonb_build_object('start', old.start, 'team', old.team, 'locked', old.locked) end);
    end if;
  end if;

  -- Publishing (or republishing) and withdrawing, which players see.
  if old_pub is distinct from new_pub and (new_pub is not null or old_pub is not null) then
    if new_pub is not null and (old_pub is null or old_pub->'publishedAt' is distinct from new_pub->'publishedAt'
        or old_pub->'team' is distinct from new_pub->'team' or old_pub->'start' is distinct from new_pub->'start') then
      diff := public.roster_diff(old_pub->'team', new_pub->'team');
      insert into public.raid_history (guild_id, week, raid_id, actor_member_id, actor_name, kind, visibility,
          affects, details, before)
        values (g, new.week, new.raid_id, actor, actor_label, 'published', 'members',
          public.team_members(old_pub->'team', new_pub->'team'),
          jsonb_build_object('roster', diff, 'republished', old_pub is not null,
            'fromStart', old_pub->'start', 'toStart', new_pub->'start'),
          case when old_pub is not null then jsonb_build_object('start', old_pub->'start', 'team', old_pub->'team',
            'locked', '[]'::jsonb) end);
    elsif new_pub is null then
      insert into public.raid_history (guild_id, week, raid_id, actor_member_id, actor_name, kind, visibility,
          affects, details, before)
        values (g, new.week, new.raid_id, actor, actor_label, 'withdrawn', 'members',
          public.team_members(old_pub->'team'), '{}',
          jsonb_build_object('start', old_pub->'start', 'team', old_pub->'team', 'locked', '[]'::jsonb));
    end if;
  end if;

  if tg_op = 'UPDATE' and old.cancelled is distinct from new.cancelled then
    insert into public.raid_history (guild_id, week, raid_id, actor_member_id, actor_name, kind, visibility,
        affects, details)
      values (g, new.week, new.raid_id, actor, actor_label, case when new.cancelled then 'cancelled' else 'uncancelled' end,
        'members', public.team_members(new.team, new.published->'team'), '{}');
  end if;

  if tg_op = 'UPDATE' and old.attendance is distinct from new.attendance then
    select jsonb_object_agg(k, jsonb_build_object('from', old.attendance->k, 'to', new.attendance->k)) into changes
      from (select jsonb_object_keys(old.attendance) k union select jsonb_object_keys(new.attendance)) keys
      where old.attendance->k is distinct from new.attendance->k;
    if changes is not null then
      insert into public.raid_history (guild_id, week, raid_id, actor_member_id, actor_name, kind, visibility,
          affects, details)
        values (g, new.week, new.raid_id, actor, actor_label, 'attendance', 'officers',
          array(select jsonb_object_keys(changes)), jsonb_build_object('attendance', changes));
    end if;
  end if;

  -- Keep half a year.
  delete from public.raid_history where guild_id = g and at < now() - interval '183 days';
  return null;
end $$;
revoke execute on function public.record_raid_history() from public, anon, authenticated;

create trigger plans_history after insert or update or delete on public.plans
  for each row execute function public.record_raid_history();

-- Officers read a raid's whole history; a player reads what players see about their own place.
create function public.get_raid_history(p_guild_id uuid, p_week date, p_raid_id text)
returns table (id uuid, at timestamptz, actor_member_id text, actor_name text, kind text, visibility text,
  affects text[], details jsonb, before jsonb, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare officer boolean := public.is_guild_officer(p_guild_id); me text := public.my_member_id(p_guild_id);
begin
  if me is null then raise exception 'You are not a guild member.' using errcode = '42501'; end if;
  return query select h.id, h.at, h.actor_member_id, h.actor_name, h.kind, h.visibility, h.affects, h.details,
      case when officer then h.before end, h.reason
    from public.raid_history h
    where h.guild_id = p_guild_id and h.week = p_week and h.raid_id = p_raid_id
      and (officer or (h.visibility = 'members' and me = any(h.affects)))
    order by h.at desc
    limit 100;
end $$;

create function public.explain_raid_change(p_guild_id uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare body text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can explain a raid change.' using errcode = '42501';
  end if;
  if char_length(coalesce(body, '')) > 300 then
    raise exception 'Keep the reason to 300 characters.' using errcode = '22023';
  end if;
  update public.raid_history set reason = body where guild_id = p_guild_id and id = p_id;
  if not found then raise exception 'That change is no longer in the history.' using errcode = '22023'; end if;
end $$;

revoke execute on function public.roster_diff(jsonb, jsonb), public.roster_members(jsonb),
  public.team_members(jsonb[]) from public, anon, authenticated;
revoke execute on function public.get_raid_history(uuid, date, text),
  public.explain_raid_change(uuid, uuid, text) from public, anon;
grant execute on function public.get_raid_history(uuid, date, text),
  public.explain_raid_change(uuid, uuid, text) to authenticated;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261102120000'::text $$;
