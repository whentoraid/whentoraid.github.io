-- One-tap app answers on the raid's Discord sign-up list. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', 'player@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'discord', '811111111111111111', '{"sub": "811111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', 'discord', '822222222222222222', '{"sub": "822222222222222222"}', now(), now(), now());
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;

-- Next week, so the raid has not started and the week's deadline (none set) cannot have passed.
create temp table t (guild uuid, week date);
grant select, insert, update on t to authenticated;
insert into t (week) values (date_trunc('week', now() at time zone 'UTC')::date + 7);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
update t set guild = public.create_guild(
  '{"name": "App sign-ups", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.members (guild_id, id, name, discord_id, position)
  select guild, v.id, v.id, v.discord, v.position from t,
    (values ('m-player', '822222222222222222', 1), ('m-other', '', 2)) v(id, discord, position);
insert into public.characters (guild_id, id, member_id, name, realm, class, spec, role, main, retired, position)
  select guild, v.id, 'm-player', v.name, 'Whitemane', v.class, v.spec, v.role, v.main, false, v.position from t,
    (values ('c-main', 'Starfall', 'Mage', 'Frost', 'DPS', true, 0), ('c-alt', 'Mender', 'Priest', 'Holy', 'Healer', false, 1))
    v(id, name, class, spec, role, main, position);
insert into public.plans (guild_id, week, raid_id, start, team, locked, attendance, cancelled)
  select guild, week, 'raid-20', (extract(epoch from (week + 4 + time '19:00') at time zone 'UTC') * 1000)::bigint,
    '[]', '[]', '{}', false from t;
-- Players have no direct access to sign-ups; the checks below read them, inside this rolled-back test.
grant select on public.raid_signups to authenticated;
create function pg_temp.signup() returns public.raid_signups language sql as $$
  select * from public.raid_signups where guild_id = (select guild from t) and member_id = 'm-player'
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select is(public.signup_from_app((select guild from t), (select week from t), 'raid-20', 'signed') ->> 'status', 'signed',
  'a player signs up from the app');
select is((pg_temp.signup()).character_id, 'c-main', 'with their main when no character is chosen');
create temp table first_signed as select (pg_temp.signup()).signed_at as at;
grant select on first_signed to authenticated;
select public.signup_from_app((select guild from t), (select week from t), 'raid-20', 'tentative', 'c-alt');
select is((pg_temp.signup()).status, 'tentative', 'answers change the same sign-up');
select is((pg_temp.signup()).character_id, 'c-alt', 'with the character chosen in the app');
select is((pg_temp.signup()).signed_at, (select at from first_signed), 'moving to tentative keeps the place in line');
select public.signup_from_app((select guild from t), (select week from t), 'raid-20', 'signed');
select is((pg_temp.signup()).character_id, 'c-alt', 'a later answer keeps the character already signed with');
select public.signup_from_app((select guild from t), (select week from t), 'raid-20', 'none');
select is((select count(*)::int from public.raid_signups where guild_id = (select guild from t)), 0,
  'taking the answer back removes the sign-up');
select throws_ok($$ select public.signup_from_app((select guild from t), (select week from t), 'raid-20', 'signed', null, 'm-other') $$,
  '42501', null, 'players cannot answer for someone else');
select throws_ok($$ select public.signup_from_app((select guild from t), (select week from t), 'raid-20', 'signed', 'c-nope') $$,
  '22023', null, 'only the player’s own characters can be chosen');
select throws_ok($$ select public.signup_from_app((select guild from t), (select week from t) - 7, 'raid-20', 'signed') $$,
  '23514', null, 'raids that are not scheduled refuse sign-ups');

-- Arriving late, said on Discord, survives "I'm in" from the app.
reset role;
insert into public.raid_signups (guild_id, week, raid_id, member_id, status, character_id)
  select guild, week, 'raid-20', 'm-player', 'late', 'c-main' from t;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select is(public.signup_from_app((select guild from t), (select week from t), 'raid-20', 'signed') ->> 'status', 'late',
  'a late sign-up stays late');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select is(public.signup_from_app((select guild from t), (select week from t), 'raid-20', 'absent', null, 'm-other') ->> 'status',
  'absent', 'an officer acting as a player answers for them');

select * from finish();
rollback;
