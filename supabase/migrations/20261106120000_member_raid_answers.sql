-- Atomic member raid answers. Existing signup_from_app remains available to older clients.
-- New clients use answer_raid exclusively; signup and check-in commit together, even after the
-- weekly deadline. Only published/recurring times are public. Undo checks the entire affected
-- check-in before restoring it, so another edit is never silently overwritten.
-- Rollback: return the frontend to the previous version; these additive RPCs/tables may stay.
-- A later forward migration may remove them after all callers have moved back. No data backfill.

create table public.raid_answer_write_guard (
  transaction_id bigint primary key,
  row_value jsonb not null,
  deleting boolean not null
);
alter table public.raid_answer_write_guard enable row level security;
revoke all on public.raid_answer_write_guard from public, anon, authenticated, service_role;

create table public.raid_answer_requests (
  id uuid primary key,
  guild_id uuid not null references public.guilds on delete cascade,
  member_id text not null,
  user_id uuid not null references auth.users on delete cascade,
  input jsonb not null,
  before_checkin jsonb,
  after_checkin jsonb,
  before_signup jsonb,
  after_signup jsonb,
  result jsonb not null,
  created_at timestamptz not null default now(),
  undone boolean not null default false,
  foreign key (guild_id, member_id) references public.members (guild_id, id) on delete cascade
);
alter table public.raid_answer_requests enable row level security;
revoke all on public.raid_answer_requests from public, anon, authenticated, service_role;
create index raid_answer_requests_age on public.raid_answer_requests (created_at);
create index raid_answer_requests_user on public.raid_answer_requests (user_id, created_at);

create or replace function public.enforce_checkin_deadline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_week date;
  row_guild uuid;
begin
  if tg_op = 'DELETE' then
    row_guild := old.guild_id;
    row_week := old.week;
  else
    row_guild := new.guild_id;
    row_week := new.week;
  end if;
  -- Only the private writer can authorize this exact row in this transaction.
  -- Auth claims remain intact; ordinary apply_guild_changes calls cannot bypass the deadline.
  if exists (select 1 from public.raid_answer_write_guard guard
      where guard.transaction_id = txid_current() and guard.row_value =
        case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
      and guard.deleting = (tg_op = 'DELETE')) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if public.is_player_not_officer(row_guild)
     and (public.checkin_deadline(row_guild, row_week) <= now()
          or (tg_op = 'UPDATE' and public.checkin_deadline(row_guild, old.week) <= now())) then
    raise exception '%', public.closed_week_message(row_week) using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;


-- Private capability: permits only the exact server-computed row, for the duration of this write.
create function public.write_raid_answer_checkin(g uuid, w date, m text, desired jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.checkins;
begin
  if desired is null then
    select * into c from public.checkins where guild_id = g and week = w and member_id = m;
    if not found then return; end if;
  else
    c := jsonb_populate_record(null::public.checkins, desired);
    if c.guild_id is distinct from g or c.week is distinct from w or c.member_id is distinct from m then
      raise exception 'Invalid answer scope.' using errcode = '22023';
    end if;
  end if;
  insert into public.raid_answer_write_guard values (txid_current(), to_jsonb(c), desired is null);
  if desired is null then
    delete from public.checkins where guild_id = g and week = w and member_id = m;
  else
    insert into public.checkins select c.*
    on conflict (guild_id, week, member_id) do update set checked_in = excluded.checked_in,
      ranges = excluded.ranges, declined = excluded.declined,
      raid_preferences = excluded.raid_preferences, availability = excluded.availability;
  end if;
  delete from public.raid_answer_write_guard where transaction_id = txid_current();
end $$;
revoke execute on function public.write_raid_answer_checkin(uuid, date, text, jsonb)
  from public, anon, authenticated, service_role;

create function public.member_raid_occurrence(g uuid, w date, r text)
returns table (start_ms bigint, end_ms bigint, cancelled boolean, published boolean, raid_name text, targets jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  raid jsonb; p public.plans; s jsonb; base jsonb; ex jsonb; d int; mins int;
  local_start timestamp; utc_start timestamptz; duration_ms bigint;
begin
  select x into raid from public.guilds gu, jsonb_array_elements(gu.settings -> 'raids') x
    where gu.id = g and x ->> 'id' = r;
  if raid is null then return; end if;
  duration_ms := (raid ->> 'durationSlots')::bigint * 30 * 60 * 1000;
  select plan.* into p from public.plans plan where plan.guild_id = g and plan.week = w and plan.raid_id = r
    and (plan.published is not null or plan.cancelled);
  if found then
    if p.published is not null then
      return query select (p.published ->> 'start')::numeric::bigint, (p.published ->> 'end')::numeric::bigint,
        p.cancelled, true, coalesce(p.published ->> 'raidName', raid ->> 'name'), raid -> 'targets';
    else
      return query select p.start, p.start + duration_ms, p.cancelled, false, raid ->> 'name', raid -> 'targets';
    end if;
    return;
  end if;
  s := raid -> 'series';
  if jsonb_typeof(s) is distinct from 'object' then return; end if;
  select c into base from jsonb_array_elements(coalesce(s -> 'changes', '[]'::jsonb)) c
    where (c ->> 'fromWeek')::date <= w order by (c ->> 'fromWeek')::date desc limit 1;
  base := coalesce(base, s);
  ex := coalesce(s -> 'exceptions' -> (w::text), '{}'::jsonb);
  d := coalesce((ex ->> 'day')::int, (base ->> 'day')::int);
  mins := coalesce((ex ->> 'minutes')::int, (base ->> 'minutes')::int);
  if w + d < (s ->> 'startDate')::date or w + d > (s ->> 'endDate')::date then return; end if;
  local_start := (w + d)::timestamp + make_interval(mins => mins);
  utc_start := local_start at time zone (s ->> 'timezone');
  if (utc_start at time zone (s ->> 'timezone')) <> local_start then return; end if;
  return query select (extract(epoch from utc_start) * 1000)::bigint,
    (extract(epoch from utc_start) * 1000)::bigint + duration_ms,
    coalesce((ex ->> 'cancelled')::boolean, false), false, raid ->> 'name', raid -> 'targets';
end $$;
revoke execute on function public.member_raid_occurrence(uuid, date, text) from public, anon, authenticated, service_role;

create function public.answer_raid(p_guild_id uuid, p_week date, p_raid_id text, p_status text,
  p_character_id text, p_spec text, p_role text, p_request_id uuid, p_member_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m text; g public.guilds; o record; chosen public.characters; existing public.raid_signups;
  c public.checkins; old_checkin jsonb; old_signup jsonb; new_signup jsonb;
  request public.raid_answer_requests; args jsonb; result jsonb;
  template jsonb; ranges int8multirange; tentative int8multirange; preferred int8multirange;
  win int8multirange; preference jsonb; declined jsonb; planning_day text;
  selected_spec text; selected_role text; deadline timestamptz; late_entry boolean;
begin
  m := coalesce(p_member_id, public.my_member_id(p_guild_id));
  if auth.uid() is null or m is null or not public.is_guild_member(p_guild_id)
      or (m is distinct from public.my_member_id(p_guild_id) and not public.is_guild_officer(p_guild_id)) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  if p_request_id is null or p_week is null or extract(isodow from p_week) <> 1
     or p_raid_id is null or p_raid_id !~ '^[a-z0-9-]{1,64}$'
     or p_status is null or p_status not in ('signed', 'late', 'tentative', 'absent') then
    raise exception 'Choose a valid raid answer.' using errcode = '22023';
  end if;
  args := jsonb_build_object('guild', p_guild_id, 'member', m, 'week', p_week, 'raid', p_raid_id,
    'status', p_status, 'character', p_character_id, 'spec', p_spec, 'role', p_role);
  -- Same lock order as guild saves and Discord answers.
  perform 1 from public.guild_revisions where guild_id = p_guild_id for update;
  if not public.is_guild_member(p_guild_id)
      or (m is distinct from public.my_member_id(p_guild_id) and not public.is_guild_officer(p_guild_id)) then
    raise exception 'Your guild access changed. Reload and try again.' using errcode = '42501';
  end if;
  select * into request from public.raid_answer_requests where id = p_request_id;
  if found then
    if request.user_id <> auth.uid() or request.input <> args then
      raise exception 'This request belongs to another answer.' using errcode = '22023';
    end if;
    if request.undone then raise exception 'This answer was undone. Choose an answer again.' using errcode = '23514'; end if;
    return request.result;
  end if;
  if (select count(*) from public.raid_answer_requests
      where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Too many changes. Please try again later.' using errcode = '23514';
  end if;
  select * into g from public.guilds where id = p_guild_id;
  select * into o from public.member_raid_occurrence(p_guild_id, p_week, p_raid_id);
  if o.start_ms is null or o.cancelled or o.start_ms <= extract(epoch from now()) * 1000 then
    raise exception 'Sign-ups for this raid have closed.' using errcode = '23514';
  end if;
  select * into existing from public.raid_signups
    where guild_id = p_guild_id and week = p_week and raid_id = p_raid_id and member_id = m;
  if found then old_signup := to_jsonb(existing); end if;
  if p_status <> 'absent' then
    select * into chosen from public.characters where guild_id = p_guild_id and member_id = m
      and not retired and (p_character_id is null or id = p_character_id)
      order by (id = existing.character_id) desc nulls last, main desc, position limit 1;
    if chosen.id is null then raise exception 'Add or choose one of your characters first.' using errcode = '22023'; end if;
    selected_spec := coalesce(p_spec, case when chosen.id = existing.character_id then existing.spec end, chosen.spec);
    selected_role := coalesce(p_role, case when chosen.id = existing.character_id then existing.role end, chosen.role);
    if not exists (select 1 from jsonb_array_elements(public.class_spec_roles(chosen.class)) option
        where option ->> 'spec' = selected_spec and option ->> 'role' = selected_role) then
      raise exception 'Choose a valid spec and role for this character.' using errcode = '22023';
    end if;
  end if;
  select * into c from public.checkins where guild_id = p_guild_id and week = p_week and member_id = m;
  if found then old_checkin := to_jsonb(c);
  else
    select t.template into template from public.availability_templates t where t.guild_id = p_guild_id and t.member_id = m;
    c.guild_id := p_guild_id; c.week := p_week; c.member_id := m;
    c.ranges := coalesce(public.template_ranges(public.template_for_week(template, p_week), p_week), '[]');
    c.declined := '[]'; c.raid_preferences := '{}'; c.availability := '{}';
  end if;
  c.checked_in := true;
  win := int8multirange(int8range(o.start_ms, o.end_ms));
  ranges := public.ranges_to_multirange(c.ranges);
  tentative := public.ranges_to_multirange(c.availability -> 'tentative');
  preferred := public.ranges_to_multirange(c.availability -> 'preferred');
  if p_status in ('signed', 'late') then
    ranges := ranges + win; tentative := tentative - win;
  elsif p_status = 'tentative' then
    ranges := ranges - win; preferred := preferred - win; tentative := tentative + win;
  end if;
  c.ranges := public.multirange_to_ranges(ranges);
  if c.availability ? 'tentative' or not isempty(tentative) then
    c.availability := c.availability || jsonb_build_object('tentative', public.multirange_to_ranges(tentative));
  end if;
  if c.availability ? 'preferred' then
    c.availability := c.availability || jsonb_build_object('preferred', public.multirange_to_ranges(preferred));
  end if;
  if p_status <> 'absent' and c.availability ? 'absent' then
    planning_day := ((to_timestamp(o.start_ms / 1000.0) at time zone g.timezone)
      - make_interval(hours => g.day_start_hour))::date::text;
    c.availability := jsonb_set(c.availability, '{absent}', coalesce((select jsonb_agg(x)
      from jsonb_array_elements(c.availability -> 'absent') x where x #>> '{}' <> planning_day), '[]'));
  end if;
  declined := coalesce(c.raid_preferences -> p_raid_id -> 'declined', c.declined, '[]');
  if chosen.id is not null then
    select coalesce(jsonb_agg(x.id order by x.position), '[]') into declined from public.characters x
      where x.guild_id = p_guild_id and x.member_id = m and not x.retired and x.id <> chosen.id;
  end if;
  preference := jsonb_build_object('participating', p_status <> 'absent', 'declined', declined);
  if chosen.id is not null then
    preference := preference || jsonb_build_object('signedAs', jsonb_build_object(
      'characterId', chosen.id, 'spec', selected_spec, 'role', selected_role));
  end if;
  c.raid_preferences := c.raid_preferences || jsonb_build_object(p_raid_id, preference);
  perform public.write_raid_answer_checkin(p_guild_id, p_week, m, to_jsonb(c));
  deadline := public.checkin_deadline(p_guild_id, p_week);
  late_entry := coalesce(existing.after_deadline, false) or (deadline is not null and deadline <= now());
  insert into public.raid_signups as s (guild_id, week, raid_id, member_id, status, character_id, spec, role, after_deadline, signed_at)
  values (p_guild_id, p_week, p_raid_id, m, p_status, chosen.id, selected_spec, selected_role, late_entry, clock_timestamp())
  on conflict (guild_id, week, raid_id, member_id) do update set status = excluded.status,
    character_id = excluded.character_id, spec = excluded.spec, role = excluded.role,
    after_deadline = excluded.after_deadline,
    signed_at = case when s.status = 'absent' or excluded.status = 'absent' then clock_timestamp() else s.signed_at end,
    updated_at = clock_timestamp();
  select to_jsonb(s) into new_signup from public.raid_signups s
    where guild_id = p_guild_id and week = p_week and raid_id = p_raid_id and member_id = m;
  update public.guild_revisions set revision = revision + 1 where guild_id = p_guild_id;
  perform public.bump_signup_post(p_guild_id, 'signup:' || p_week::text || '/' || p_raid_id);
  result := jsonb_build_object('signup', new_signup, 'undoId', p_request_id,
    'occurrence', jsonb_build_object('start', o.start_ms, 'end', o.end_ms));
  insert into public.raid_answer_requests (id, guild_id, member_id, user_id, input, before_checkin,
    after_checkin, before_signup, after_signup, result)
  values (p_request_id, p_guild_id, m, auth.uid(), args, old_checkin, to_jsonb(c), old_signup, new_signup, result);
  delete from public.raid_answer_requests where created_at < now() - interval '1 day';
  return result;
end $$;

create function public.undo_raid_answer(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request public.raid_answer_requests; latest_checkin jsonb; latest_signup jsonb;
  previous public.raid_signups; w date; r text; o record;
begin
  select * into request from public.raid_answer_requests where id = p_request_id and user_id = auth.uid();
  if not found or not public.is_guild_member(request.guild_id)
      or (public.my_member_id(request.guild_id) is distinct from request.member_id
        and not public.is_guild_officer(request.guild_id)) then
    raise exception 'This answer is not available to undo.' using errcode = '42501';
  end if;
  perform 1 from public.guild_revisions where guild_id = request.guild_id for update;
  select * into request from public.raid_answer_requests where id = p_request_id;
  if not found or not public.is_guild_member(request.guild_id)
      or (public.my_member_id(request.guild_id) is distinct from request.member_id
        and not public.is_guild_officer(request.guild_id)) then
    raise exception 'This answer is not available to undo.' using errcode = '42501';
  end if;
  if request.undone then return jsonb_build_object('signup', request.before_signup); end if;
  w := (request.input ->> 'week')::date; r := request.input ->> 'raid';
  select * into o from public.member_raid_occurrence(request.guild_id, w, r);
  if request.created_at < now() - interval '15 minutes' or o.start_ms is null or o.cancelled
      or o.start_ms <= extract(epoch from now()) * 1000
      or request.result -> 'occurrence' is distinct from jsonb_build_object('start', o.start_ms, 'end', o.end_ms) then
    raise exception 'This answer can no longer be undone.' using errcode = '23514';
  end if;
  select to_jsonb(c) into latest_checkin from public.checkins c
    where guild_id = request.guild_id and week = w and member_id = request.member_id;
  select to_jsonb(s) into latest_signup from public.raid_signups s
    where guild_id = request.guild_id and week = w and raid_id = r and member_id = request.member_id;
  if latest_checkin is distinct from request.after_checkin or latest_signup is distinct from request.after_signup then
    raise exception 'Your answer or availability changed since. Review the current answer instead.' using errcode = '40001';
  end if;
  perform public.write_raid_answer_checkin(request.guild_id, w, request.member_id, request.before_checkin);
  if request.before_signup is null then
    delete from public.raid_signups where guild_id = request.guild_id and week = w and raid_id = r and member_id = request.member_id;
  else
    previous := jsonb_populate_record(null::public.raid_signups, request.before_signup);
    update public.raid_signups set status = previous.status, character_id = previous.character_id,
      spec = previous.spec, role = previous.role, after_deadline = previous.after_deadline,
      signed_at = previous.signed_at, updated_at = clock_timestamp()
      where guild_id = request.guild_id and week = w and raid_id = r and member_id = request.member_id;
  end if;
  update public.raid_answer_requests set undone = true where id = p_request_id;
  update public.guild_revisions set revision = revision + 1 where guild_id = request.guild_id;
  perform public.bump_signup_post(request.guild_id, 'signup:' || w::text || '/' || r);
  return jsonb_build_object('signup', request.before_signup);
end $$;

revoke execute on function public.answer_raid(uuid, date, text, text, text, text, text, uuid, text),
  public.undo_raid_answer(uuid) from public, anon;
grant execute on function public.answer_raid(uuid, date, text, text, text, text, text, uuid, text),
  public.undo_raid_answer(uuid) to authenticated;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261106120000'::text $$;
