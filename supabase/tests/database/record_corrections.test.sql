-- Record corrections: a player flags their own record, officers resolve with attribution, and a flag
-- never changes attendance. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'ash@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'bo@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'discord', '711111111111111113', '{"sub": "711111111111111113"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', 'discord', '722222222222222223', '{"sub": "722222222222222223"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c3', 'discord', '733333333333333334', '{"sub": "733333333333333334"}', now(), now(), now());
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.officer() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1') $$;
create function pg_temp.ash() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2') $$;
create function pg_temp.bo() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3') $$;

-- Last week's raid, already run, with Ash recorded as a no-show.
create temp table t (guild uuid, week date, flag uuid);
grant select, insert, update on t to authenticated;
insert into t (week) values (date_trunc('week', now() at time zone 'UTC')::date - 7);
select pg_temp.officer();
update t set guild = public.create_guild(
  '{"name": "Records", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.members (guild_id, id, name, discord_id, position)
  select guild, v.id, v.id, v.discord, v.position from t,
    (values ('m-ash', '722222222222222223', 1), ('m-bo', '733333333333333334', 2)) v(id, discord, position);
insert into public.plans (guild_id, week, raid_id, start, team, locked, attendance, cancelled)
  select guild, week, 'raid-20', 1, '[{"memberId": "m-ash", "characterId": "c-ash", "role": "Tank"}]', '[]',
    '{"m-ash": "noshow"}', false from t;

select pg_temp.ash();
select throws_ok($$ select public.flag_raid_record((select guild from t), (select week from t), 'raid-20', '   ') $$,
  '22023', 'Say what looks wrong, in up to 500 characters.', 'a flag says what is wrong');
select throws_ok($$ select public.flag_raid_record((select guild from t), (select week from t) - 7, 'raid-20', 'Wrong') $$,
  '23514', 'That raid has no roster to correct.', 'a flag is about a raid that was planned');
update t set flag = public.flag_raid_record((select guild from t), (select week from t), 'raid-20',
  'I was there, just on voice late.');
select ok((select flag from t) is not null, 'a player flags their own record');
select throws_ok($$ select public.flag_raid_record((select guild from t), (select week from t), 'raid-20', 'Again') $$,
  '23514', 'You have already reported this raid. Officers will look at it.', 'one open flag per raid');
select is((select count(*)::int from public.get_raid_record_flags((select guild from t))), 1, 'the player sees their flag');
select throws_ok($$ select public.resolve_raid_record_flag((select guild from t), (select flag from t), 'No') $$,
  '42501', 'Only officers can resolve a record correction.', 'a player cannot resolve their own flag');

select pg_temp.bo();
select is((select count(*)::int from public.get_raid_record_flags((select guild from t))), 0,
  'another player does not see it');

reset role;
select is((select attendance ->> 'm-ash' from public.plans where guild_id = (select guild from t) and raid_id = 'raid-20'),
  'noshow', 'a flag does not change attendance');

select pg_temp.officer();
select is((select note from public.get_raid_record_flags((select guild from t))), 'I was there, just on voice late.',
  'officers see every flag');
select lives_ok($$ select public.resolve_raid_record_flag((select guild from t), (select flag from t), 'Changed to late.') $$,
  'an officer resolves it with a reply');
select throws_ok($$ select public.resolve_raid_record_flag((select guild from t), (select flag from t)) $$,
  '23514', 'That correction was already resolved.', 'a flag is resolved once');

select pg_temp.ash();
select is((select row(status, resolved_by, reply)::text from public.get_raid_record_flags((select guild from t))),
  '(resolved,m-officer,"Changed to late.")', 'the player sees who resolved it and the reply');
select lives_ok($$ select public.flag_raid_record((select guild from t), (select week from t), 'raid-20', 'Still wrong') $$,
  'a resolved flag can be followed by a new one');

reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.get_raid_record_flags((select guild from t)) $$,
  '42501', 'You are not a guild member.', 'someone signed out reads nothing');

select * from finish();
rollback;
