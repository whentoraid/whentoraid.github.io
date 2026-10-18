-- Record corrections (M08). A player flags a factual mistake in their own raid record for officers to
-- review. A flag never changes attendance: an officer corrects the record in the planner and resolves
-- the flag, and the resolution names that officer. The table is reached only through the functions below.

create table public.raid_record_flags (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null,
  week date not null check (extract(isodow from week) = 1),
  raid_id text not null check (raid_id ~ '^[a-z0-9-]{1,64}$'),
  member_id text not null,
  note text not null check (char_length(btrim(note)) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  -- The officer who resolved it, kept as text so the record survives that officer leaving.
  resolved_by text,
  resolved_at timestamptz,
  reply text check (reply is null or char_length(reply) <= 500),
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade,
  check ((status = 'resolved') = (resolved_at is not null))
);
alter table public.raid_record_flags enable row level security;
revoke all on public.raid_record_flags from public, anon, authenticated;
-- One open flag per player and raid; a resolved one can be followed by a new one.
create unique index raid_record_flags_one_open on public.raid_record_flags (guild_id, week, raid_id, member_id)
  where status = 'open';

create function public.flag_raid_record(p_guild_id uuid, p_week date, p_raid_id text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m text := public.my_member_id(p_guild_id); flag_id uuid;
begin
  if m is null then raise exception 'Sign in as a member of this guild.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 1 and 500 then
    raise exception 'Say what looks wrong, in up to 500 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where guild_id = p_guild_id and week = p_week and raid_id = p_raid_id) then
    raise exception 'That raid has no roster to correct.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.raid_record_flags where guild_id = p_guild_id and week = p_week
      and raid_id = p_raid_id and member_id = m and status = 'open') then
    raise exception 'You have already reported this raid. Officers will look at it.' using errcode = 'check_violation';
  end if;
  insert into public.raid_record_flags (guild_id, week, raid_id, member_id, note)
    values (p_guild_id, p_week, p_raid_id, m, btrim(p_note)) returning id into flag_id;
  return flag_id;
end $$;

-- Officers read every flag; a player reads only their own. Newest first.
create function public.get_raid_record_flags(p_guild_id uuid)
returns table (id uuid, week date, raid_id text, member_id text, note text, status text, created_at timestamptz,
  resolved_by text, resolved_at timestamptz, reply text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_member(p_guild_id) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  return query select f.id, f.week, f.raid_id, f.member_id, f.note, f.status, f.created_at, f.resolved_by,
      f.resolved_at, f.reply
    from public.raid_record_flags f
    where f.guild_id = p_guild_id
      and (public.is_guild_officer(p_guild_id) or f.member_id = public.my_member_id(p_guild_id))
    order by f.created_at desc
    limit 200;
end $$;

create function public.resolve_raid_record_flag(p_guild_id uuid, p_id uuid, p_reply text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare officer text := public.my_member_id(p_guild_id);
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can resolve a record correction.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_reply, '')) > 500 then
    raise exception 'Keep the reply to 500 characters.' using errcode = '22023';
  end if;
  update public.raid_record_flags set status = 'resolved', resolved_by = officer, resolved_at = now(),
      reply = nullif(btrim(coalesce(p_reply, '')), '')
    where guild_id = p_guild_id and id = p_id and status = 'open';
  if not found then
    raise exception 'That correction was already resolved.' using errcode = 'check_violation';
  end if;
end $$;

revoke execute on function public.flag_raid_record(uuid, date, text, text),
  public.get_raid_record_flags(uuid), public.resolve_raid_record_flag(uuid, uuid, text) from public, anon;
grant execute on function public.flag_raid_record(uuid, date, text, text),
  public.get_raid_record_flags(uuid), public.resolve_raid_record_flag(uuid, uuid, text) to authenticated;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261031120000'::text $$;
