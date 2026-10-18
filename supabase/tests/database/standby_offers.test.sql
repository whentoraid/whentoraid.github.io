-- Standby and place offers (app only). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000a2', 'ash@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000a3', 'bo@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000a4', 'rostered@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'discord', '711111111111111111', '{"sub": "711111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000a2', 'discord', '722222222222222222', '{"sub": "722222222222222222"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000a3', 'discord', '733333333333333333', '{"sub": "733333333333333333"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000a4', 'discord', '744444444444444444', '{"sub": "744444444444444444"}', now(), now(), now());
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.officer() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1') $$;
create function pg_temp.ash() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2') $$;
create function pg_temp.bo() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3') $$;
create function pg_temp.rostered() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4') $$;

-- Next week, so the raid has not started.
create temp table t (guild uuid, week date, start bigint);
create temp table offer (who text primary key, id uuid);
grant select, insert, update on t, offer to authenticated;
insert into t (week) values (date_trunc('week', now() at time zone 'UTC')::date + 7);
select pg_temp.officer();
update t set guild = public.create_guild(
  '{"name": "Standby", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}');
reset role;
select set_config('request.jwt.claims', '', true);
update t set start = (extract(epoch from (week + 4 + time '19:00') at time zone 'UTC') * 1000)::bigint;
insert into public.members (guild_id, id, name, discord_id, position)
  select guild, v.id, v.id, v.discord, v.position from t,
    (values ('m-ash', '722222222222222222', 1), ('m-bo', '733333333333333333', 2), ('m-in', '744444444444444444', 3)) v(id, discord, position);
insert into public.characters (guild_id, id, member_id, name, realm, class, spec, role, main, retired, position)
  select guild, v.id, v.member, v.id, 'Whitemane', 'Warrior', 'Protection', 'Tank', v.main, v.retired, v.position from t,
    (values ('c-ash', 'm-ash', true, false, 0), ('c-bo', 'm-bo', true, false, 0), ('c-bo-old', 'm-bo', false, true, 1),
      ('c-in', 'm-in', true, false, 0)) v(id, member, main, retired, position);
insert into public.plans (guild_id, week, raid_id, start, team, locked, attendance, cancelled, published)
  select guild, week, 'raid-20', start, '[]', '[]', '{}', false,
    jsonb_build_object('start', start, 'end', start + 10800000, 'day', 4, 'startSlot', 2, 'raidName', '20-player Raid',
      'publishedAt', 1, 'targets', '[2, 4, 14]'::jsonb,
      'team', '[{"memberId": "m-in", "characterId": "c-in", "role": "Tank"}]'::jsonb)
  from t;
-- Players cannot read these tables, so the checks read them as the test's owner.
create function pg_temp.response(m text) returns public.raid_responses language sql security definer as $$
  select * from public.raid_responses where guild_id = (select guild from t) and member_id = m
$$;
create function pg_temp.offer_row(w text) returns public.raid_offers language sql security definer as $$
  select * from public.raid_offers where id = (select id from offer where who = w)
$$;

-- Standby
select pg_temp.ash();
select lives_ok($$ select public.set_raid_standby((select guild from t), (select week from t), 'raid-20', true, 'c-ash') $$,
  'a player without a place goes on standby');
select is((select count(*)::int from public.get_raid_standby((select guild from t), (select week from t))), 1,
  'and sees their own standby');
select throws_ok($$ select public.set_raid_standby((select guild from t), (select week from t), 'raid-20', true, 'c-bo') $$,
  '22023', null, 'only with one of their own characters');
select throws_ok($$ select public.set_raid_standby((select guild from t), (select week from t), 'raid-20', true, null,
    (extract(epoch from now()) * 1000)::bigint - 1) $$,
  '22023', null, 'reachable-until must be later than now');
select pg_temp.rostered();
select throws_ok($$ select public.set_raid_standby((select guild from t), (select week from t), 'raid-20', true) $$,
  '23514', null, 'a rostered player cannot go on standby for the same raid');
select pg_temp.bo();
select is((select count(*)::int from public.get_raid_standby((select guild from t), (select week from t))), 0,
  'players do not see each other’s standby');
select pg_temp.officer();
select is((select member_id from public.get_raid_standby((select guild from t), (select week from t))), 'm-ash',
  'officers see who is on standby');

-- Offers
select pg_temp.ash();
select throws_ok($$ select public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-in', 'm-ash', 'c-ash',
    now() + interval '3 hours') $$, '42501', null, 'players cannot offer places');
select pg_temp.officer();
insert into offer values
  ('ash', public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-in', 'm-ash', 'c-ash', now() + interval '3 hours')),
  ('bo', public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-in', 'm-bo', 'c-bo', now() + interval '3 hours'));
select is((pg_temp.offer_row('ash')).role, 'Tank', 'the offered place keeps its published role');
select throws_ok($$ select public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-in', 'm-bo', 'c-bo-old',
    now() + interval '3 hours') $$, '22023', null, 'a retired character cannot be offered a place');
select throws_ok($$ select public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-ash', 'm-bo', 'c-bo',
    now() + interval '3 hours') $$, '23514', null, 'only a place in the published roster can be offered');
select throws_ok($$ select public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-in', 'm-in', 'c-in',
    now() + interval '3 hours') $$, '23514', null, 'a player who already has a place cannot be offered one');
-- Offering again replaces the open offer, and no offer lasts past the raid's start.
update offer set id = public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-in', 'm-bo', 'c-bo',
  now() + interval '30 days') where who = 'bo';
select is((select count(*)::int from public.get_raid_offers((select guild from t), (select week from t))
    where member_id = 'm-bo' and status = 'open'), 1, 'offering the same place again replaces the open offer');
select is((pg_temp.offer_row('bo')).expires_at, (select to_timestamp(start / 1000.0) from t),
  'an offer closes no later than the raid starts');

-- Answers
select pg_temp.bo();
select throws_ok($$ select public.respond_to_raid_offer((select guild from t), (select id from offer where who = 'ash'), true) $$,
  '42501', null, 'players can answer only their own offers');
select pg_temp.ash();
select is(public.respond_to_raid_offer((select guild from t), (select id from offer where who = 'ash'), true), 'accepted',
  'the first player to accept takes the place');
select is((pg_temp.offer_row('bo')).status, 'filled', 'the other offers for that place close');
select pg_temp.bo();
select throws_ok($$ select public.respond_to_raid_offer((select guild from t), (select id from offer where who = 'bo'), true) $$,
  '23514', 'Someone else accepted this place first.', 'a later acceptance is refused and says why');
select pg_temp.officer();
select is((select count(*)::int from public.get_raid_standby((select guild from t), (select week from t))), 0,
  'accepting takes the player off standby');
select is((pg_temp.response('m-ash')).assignment, (select 'c-ash|Tank|' || start || '|' || (start + 10800000) from t),
  'accepting confirms the player for that place once it is published');
select throws_ok($$ select public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-in', 'm-bo', 'c-bo',
    now() + interval '3 hours') $$, '23514', null, 'a place someone accepted cannot be offered again');

-- An offer past its deadline reads as expired and cannot be accepted.
select public.withdraw_raid_offer((select guild from t), (select id from offer where who = 'ash'));
update offer set id = public.offer_raid_place((select guild from t), (select week from t), 'raid-20', 'm-in', 'm-bo', 'c-bo',
  now() + interval '1 hour') where who = 'bo';
reset role;
update public.raid_offers set expires_at = now() - interval '1 minute' where id = (select id from offer where who = 'bo');
select pg_temp.bo();
select throws_ok($$ select public.respond_to_raid_offer((select guild from t), (select id from offer where who = 'bo'), true) $$,
  '23514', 'This offer has expired.', 'an expired offer cannot be accepted');

select * from finish();
rollback;
