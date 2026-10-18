-- Standby as an explicit offer and accept (M07). App only for now: nothing here posts to Discord.
--
-- Players opt into standby for a published raid, optionally until a time, and can withdraw without it
-- reading as a missed raid. When a rostered player can't come, an officer offers that place to one or
-- more players with a response deadline. The first to accept holds it; the others' offers close.
-- Accepting never changes the published roster: officers put the player in the draft and publish, and
-- the acceptance then counts as the player's confirmation. Both tables are reached only through the
-- functions below.

create table public.raid_standby (
  guild_id uuid not null,
  week date not null check (extract(isodow from week) = 1),
  raid_id text not null check (raid_id ~ '^[a-z0-9-]{1,64}$'),
  member_id text not null,
  character_id text check (character_id is null or char_length(character_id) between 1 and 64),
  -- Reachable until this instant (epoch ms); null means until the raid starts.
  until_ms bigint,
  updated_at timestamptz not null default now(),
  primary key (guild_id, week, raid_id, member_id),
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade
);
alter table public.raid_standby enable row level security;
revoke all on public.raid_standby from public, anon, authenticated;

create table public.raid_offers (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null,
  week date not null check (extract(isodow from week) = 1),
  raid_id text not null check (raid_id ~ '^[a-z0-9-]{1,64}$'),
  -- The published place on offer: whose it was, and its role.
  vacated_member_id text not null,
  role text not null check (role in ('Tank', 'Healer', 'DPS')),
  member_id text not null,
  character_id text not null check (char_length(character_id) between 1 and 64),
  expires_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'withdrawn', 'filled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade
);
alter table public.raid_offers enable row level security;
revoke all on public.raid_offers from public, anon, authenticated;
-- One holder per place, and one open offer per player for a place.
create unique index raid_offers_one_holder on public.raid_offers (guild_id, week, raid_id, vacated_member_id)
  where status = 'accepted';
create unique index raid_offers_one_open on public.raid_offers (guild_id, week, raid_id, vacated_member_id, member_id)
  where status = 'open';

-- The published raid this week, or an error a person can act on.
create function public.open_published_raid(g uuid, w date, r text) returns public.plans
language plpgsql stable security definer set search_path = '' as $$
declare p public.plans;
begin
  select * into p from public.plans where guild_id = g and week = w and raid_id = r;
  if p.published is null or p.cancelled then
    raise exception 'This raid has no published roster.' using errcode = 'check_violation';
  end if;
  if (p.published ->> 'start')::numeric <= extract(epoch from now()) * 1000 then
    raise exception 'This raid has started.' using errcode = 'check_violation';
  end if;
  return p;
end $$;

create function public.in_published_team(p public.plans, m text) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p.published -> 'team', '[]')) e where e ->> 'memberId' = m)
$$;

-- Another published raid the member holds a place in that overlaps this one.
create function public.overlapping_commitment(g uuid, w date, r text, m text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(o.published ->> 'raidName', o.raid_id) from public.plans p, public.plans o
  where p.guild_id = g and p.week = w and p.raid_id = r and o.guild_id = g and o.raid_id <> r
    and o.published is not null and not o.cancelled and public.in_published_team(o, m)
    and (o.published ->> 'start')::numeric < (p.published ->> 'end')::numeric
    and (o.published ->> 'end')::numeric > (p.published ->> 'start')::numeric
  limit 1
$$;

-- ---------------------------------------------------------------------------------------------
-- Standby. A player sets or clears their own; officers read everyone's for the week.
create function public.set_raid_standby(
  p_guild_id uuid, p_week date, p_raid_id text, p_on boolean, p_character_id text default null, p_until_ms bigint default null
) returns void language plpgsql security definer set search_path = '' as $$
declare m text := public.my_member_id(p_guild_id); p public.plans;
begin
  if m is null then raise exception 'Sign in as a member of this guild.' using errcode = '42501'; end if;
  if not p_on then
    delete from public.raid_standby where guild_id = p_guild_id and week = p_week and raid_id = p_raid_id and member_id = m;
    return;
  end if;
  p := public.open_published_raid(p_guild_id, p_week, p_raid_id);
  if public.in_published_team(p, m) then
    raise exception 'You already have a place in this raid.' using errcode = 'check_violation';
  end if;
  if p_character_id is not null and not exists (select 1 from public.characters c where c.guild_id = p_guild_id
      and c.id = p_character_id and c.member_id = m and not c.retired) then
    raise exception 'Choose one of your characters.' using errcode = '22023';
  end if;
  if p_until_ms is not null and p_until_ms <= extract(epoch from now()) * 1000 then
    raise exception 'Choose a time later than now.' using errcode = '22023';
  end if;
  insert into public.raid_standby (guild_id, week, raid_id, member_id, character_id, until_ms, updated_at)
    values (p_guild_id, p_week, p_raid_id, m, p_character_id, p_until_ms, now())
  on conflict (guild_id, week, raid_id, member_id) do update set character_id = excluded.character_id,
    until_ms = excluded.until_ms, updated_at = now();
end $$;

create function public.get_raid_standby(p_guild_id uuid, p_week date)
returns table (raid_id text, member_id text, character_id text, until_ms bigint, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_member(p_guild_id) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  return query select s.raid_id, s.member_id, s.character_id, s.until_ms, s.updated_at from public.raid_standby s
    where s.guild_id = p_guild_id and s.week = p_week
      and (public.is_guild_officer(p_guild_id) or s.member_id = public.my_member_id(p_guild_id))
    order by s.updated_at;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Offers. Officers offer and withdraw; the offered player accepts or declines.
create function public.offer_raid_place(
  p_guild_id uuid, p_week date, p_raid_id text, p_vacated_member_id text, p_member_id text,
  p_character_id text, p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.plans; place_role text; offer_id uuid; c public.characters;
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can offer a place.' using errcode = '42501';
  end if;
  p := public.open_published_raid(p_guild_id, p_week, p_raid_id);
  select e ->> 'role' into place_role from jsonb_array_elements(p.published -> 'team') e
    where e ->> 'memberId' = p_vacated_member_id limit 1;
  if place_role is null then
    raise exception 'That place is not in the published roster.' using errcode = 'check_violation';
  end if;
  if public.in_published_team(p, p_member_id) then
    raise exception 'That player already has a place in this raid.' using errcode = 'check_violation';
  end if;
  select * into c from public.characters where guild_id = p_guild_id and id = p_character_id
    and member_id = p_member_id and not retired;
  if not found then raise exception 'Choose one of that player’s characters.' using errcode = '22023'; end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Choose a response deadline later than now.' using errcode = '22023';
  end if;
  if exists (select 1 from public.raid_offers where guild_id = p_guild_id and week = p_week and raid_id = p_raid_id
      and vacated_member_id = p_vacated_member_id and status = 'accepted') then
    raise exception 'Someone has already accepted that place.' using errcode = 'check_violation';
  end if;
  -- Offering the same place to the same player again replaces the open offer.
  update public.raid_offers set status = 'withdrawn', responded_at = now()
    where guild_id = p_guild_id and week = p_week and raid_id = p_raid_id and vacated_member_id = p_vacated_member_id
      and member_id = p_member_id and status = 'open';
  insert into public.raid_offers (guild_id, week, raid_id, vacated_member_id, role, member_id, character_id, expires_at)
    values (p_guild_id, p_week, p_raid_id, p_vacated_member_id, place_role, p_member_id, p_character_id,
      -- Never past the raid's start.
      least(p_expires_at, to_timestamp((p.published ->> 'start')::numeric / 1000)))
    returning id into offer_id;
  return offer_id;
end $$;

create function public.withdraw_raid_offer(p_guild_id uuid, p_offer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only officers can withdraw an offer.' using errcode = '42501';
  end if;
  update public.raid_offers set status = 'withdrawn', responded_at = now()
    where id = p_offer_id and guild_id = p_guild_id and status in ('open', 'accepted');
end $$;

create function public.respond_to_raid_offer(p_guild_id uuid, p_offer_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare m text := public.my_member_id(p_guild_id); o public.raid_offers; p public.plans; clash text;
begin
  if m is null then raise exception 'Sign in as a member of this guild.' using errcode = '42501'; end if;
  -- Lock every offer for the place, so two players cannot both accept it.
  perform 1 from public.raid_offers x join public.raid_offers y on y.guild_id = x.guild_id and y.week = x.week
      and y.raid_id = x.raid_id and y.vacated_member_id = x.vacated_member_id
    where x.id = p_offer_id for update of y;
  select * into o from public.raid_offers where id = p_offer_id and guild_id = p_guild_id and member_id = m;
  if not found then raise exception 'That offer is not yours.' using errcode = '42501'; end if;
  if o.status <> 'open' then
    raise exception '%', case o.status when 'filled' then 'Someone else accepted this place first.'
      when 'withdrawn' then 'The officers withdrew this offer.' else 'You already answered this offer.' end
      using errcode = 'check_violation';
  end if;
  if o.expires_at <= now() then raise exception 'This offer has expired.' using errcode = 'check_violation'; end if;
  if not p_accept then
    update public.raid_offers set status = 'declined', responded_at = now() where id = o.id;
    return 'declined';
  end if;
  -- Check the place, character and other commitments again now.
  p := public.open_published_raid(o.guild_id, o.week, o.raid_id);
  if not public.in_published_team(p, o.vacated_member_id) or public.in_published_team(p, m) then
    raise exception 'The published roster changed, so this place is no longer open. Ask an officer.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.characters c where c.guild_id = o.guild_id and c.id = o.character_id
      and c.member_id = m and not c.retired) then
    raise exception 'The character on this offer is no longer active. Ask an officer.' using errcode = 'check_violation';
  end if;
  clash := public.overlapping_commitment(o.guild_id, o.week, o.raid_id, m);
  if clash is not null then
    raise exception 'You already have a place in %, which overlaps this raid.', clash using errcode = 'check_violation';
  end if;
  update public.raid_offers set status = 'accepted', responded_at = now() where id = o.id;
  update public.raid_offers set status = 'filled', responded_at = now()
    where guild_id = o.guild_id and week = o.week and raid_id = o.raid_id
      and vacated_member_id = o.vacated_member_id and status = 'open';
  delete from public.raid_standby where guild_id = o.guild_id and week = o.week and raid_id = o.raid_id and member_id = m;
  -- Accepting is the player's answer: once officers publish them in this place at this time, it reads
  -- as Confirmed without asking again (a different character, role or time asks as usual).
  insert into public.raid_responses (guild_id, week, raid_id, member_id, publication, assignment, status, note, updated_at)
    values (o.guild_id, o.week, o.raid_id, m, p.published ->> 'publishedAt',
      o.character_id || '|' || o.role || '|' || (p.published ->> 'start') || '|' || (p.published ->> 'end'),
      'confirmed', 'Accepted a standby offer', now())
  on conflict (guild_id, week, raid_id, member_id) do update set publication = excluded.publication,
    assignment = excluded.assignment, status = excluded.status, note = excluded.note, updated_at = excluded.updated_at;
  return 'accepted';
end $$;

-- Officers see the week's offers; players see their own. An open offer past its deadline reads as expired.
create function public.get_raid_offers(p_guild_id uuid, p_week date)
returns table (id uuid, raid_id text, vacated_member_id text, role text, member_id text, character_id text,
  expires_at timestamptz, status text, created_at timestamptz, responded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_member(p_guild_id) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  return query select o.id, o.raid_id, o.vacated_member_id, o.role, o.member_id, o.character_id, o.expires_at,
      case when o.status = 'open' and o.expires_at <= now() then 'expired' else o.status end,
      o.created_at, o.responded_at
    from public.raid_offers o
    where o.guild_id = p_guild_id and o.week = p_week
      and (public.is_guild_officer(p_guild_id) or o.member_id = public.my_member_id(p_guild_id))
    order by o.created_at;
end $$;

revoke execute on function public.open_published_raid(uuid, date, text), public.in_published_team(public.plans, text),
  public.overlapping_commitment(uuid, date, text, text) from public, anon, authenticated;
revoke execute on function public.set_raid_standby(uuid, date, text, boolean, text, bigint),
  public.get_raid_standby(uuid, date),
  public.offer_raid_place(uuid, date, text, text, text, text, timestamptz),
  public.withdraw_raid_offer(uuid, uuid), public.respond_to_raid_offer(uuid, uuid, boolean),
  public.get_raid_offers(uuid, date) from public, anon;
grant execute on function public.set_raid_standby(uuid, date, text, boolean, text, bigint),
  public.get_raid_standby(uuid, date),
  public.offer_raid_place(uuid, date, text, text, text, text, timestamptz),
  public.withdraw_raid_offer(uuid, uuid), public.respond_to_raid_offer(uuid, uuid, boolean),
  public.get_raid_offers(uuid, date) to authenticated;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261026120000'::text $$;
