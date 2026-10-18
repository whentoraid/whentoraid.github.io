-- One-tap raid answers in the app also sign the player up on the raid's Discord sign-up list (M03):
-- the same raid_signups row a Discord button press writes, so the card, the Planner's sign-up panel
-- and the app agree. The app saves the check-in itself through apply_guild_changes, so this writes
-- only the sign-up and leaves the guild revision alone.
--
-- p_status: 'signed', 'tentative' or 'absent' as on Discord, or 'none' to take an answer back (Undo
-- of a first answer). Players change only their own sign-up, and not after the week's check-in
-- deadline, matching enforce_checkin_deadline. Officers may, and may answer for a member they act as
-- (p_member_id).
create function public.signup_from_app(
  p_guild_id uuid, p_week date, p_raid_id text, p_status text, p_character_id text default null,
  p_member_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_member text; o record; existing public.raid_signups; chosen public.characters;
  deadline timestamptz; late_entry boolean; next_status text; same_character boolean;
begin
  if p_week is null or extract(isodow from p_week) <> 1 or p_raid_id is null or p_raid_id !~ '^[a-z0-9-]{1,64}$'
     or p_status is null or p_status not in ('signed', 'tentative', 'absent', 'none')
     or (p_character_id is not null and char_length(p_character_id) not between 1 and 64) then
    raise exception 'Invalid sign-up.' using errcode = '22023';
  end if;
  v_member := public.my_member_id(p_guild_id);
  if v_member is null and not public.is_guild_officer(p_guild_id) then
    raise exception 'You are not a guild member.' using errcode = '42501';
  end if;
  if p_member_id is not null and p_member_id is distinct from v_member then
    if not public.is_guild_officer(p_guild_id) then
      raise exception 'Only officers can answer for another player.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.members m where m.guild_id = p_guild_id and m.id = p_member_id) then
      raise exception 'Player not found.' using errcode = '22023';
    end if;
    v_member := p_member_id;
  end if;
  if v_member is null then raise exception 'Choose a player to answer for.' using errcode = '22023'; end if;
  deadline := public.checkin_deadline(p_guild_id, p_week);
  late_entry := deadline is not null and deadline <= now();
  if late_entry and public.is_player_not_officer(p_guild_id) then
    raise exception '%', public.closed_week_message(p_week) using errcode = 'check_violation';
  end if;
  select * into o from public.raid_occurrence(p_guild_id, p_week, p_raid_id);
  if o.start_ms is null or o.cancelled or o.start_ms <= extract(epoch from now()) * 1000 then
    raise exception 'Sign-ups for this raid have closed.' using errcode = 'check_violation';
  end if;

  select * into existing from public.raid_signups s
    where s.guild_id = p_guild_id and s.week = p_week and s.raid_id = p_raid_id and s.member_id = v_member;
  if p_status = 'none' then
    delete from public.raid_signups s
      where s.guild_id = p_guild_id and s.week = p_week and s.raid_id = p_raid_id and s.member_id = v_member;
    if found then perform public.bump_signup_post(p_guild_id, 'signup:' || p_week::text || '/' || p_raid_id); end if;
    return jsonb_build_object('status', 'none');
  end if;

  -- The character: the one chosen in the app, else the one already signed with, else the main.
  if p_status <> 'absent' then
    select * into chosen from public.characters c
      where c.guild_id = p_guild_id and c.member_id = v_member and not c.retired
        and (p_character_id is null or c.id = p_character_id)
      order by (c.id = existing.character_id) desc nulls last, c.main desc, c.position limit 1;
    if p_character_id is not null and chosen.id is null then
      raise exception 'Choose one of your characters.' using errcode = '22023';
    end if;
  end if;
  -- Arriving late was said on Discord; "I'm in" from the app keeps it.
  next_status := case when p_status = 'signed' and existing.status = 'late' then 'late' else p_status end;
  if existing.status = next_status and existing.character_id is not distinct from chosen.id then
    return jsonb_build_object('status', next_status);
  end if;
  same_character := chosen.id is not null and existing.character_id is not distinct from chosen.id;
  insert into public.raid_signups as s (guild_id, week, raid_id, member_id, status, character_id, after_deadline, signed_at, updated_at)
  values (p_guild_id, p_week, p_raid_id, v_member, next_status, chosen.id, late_entry, clock_timestamp(), now())
  on conflict (guild_id, week, raid_id, member_id) do update set status = excluded.status,
    character_id = excluded.character_id, after_deadline = s.after_deadline or excluded.after_deadline,
    -- As on Discord: changing character or moving between Sign up and Tentative keeps the player's place.
    signed_at = case when s.status = 'absent' or excluded.status = 'absent' then clock_timestamp() else s.signed_at end,
    spec = case when same_character then s.spec end, role = case when same_character then s.role end,
    updated_at = now();
  perform public.bump_signup_post(p_guild_id, 'signup:' || p_week::text || '/' || p_raid_id);
  return jsonb_build_object('status', next_status);
end $$;
revoke execute on function public.signup_from_app(uuid, date, text, text, text, text) from public, anon;
grant execute on function public.signup_from_app(uuid, date, text, text, text, text) to authenticated;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261025120000'::text $$;
