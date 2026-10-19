-- Raid history: plan changes are recorded with who made them, draft bursts merge, officers see
-- everything, players see published changes about their own place. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 'ash@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000e3', 'bo@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'discord', '911111111111111113', '{"sub": "911111111111111113"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', 'discord', '922222222222222223', '{"sub": "922222222222222223"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e3', 'discord', '933333333333333334', '{"sub": "933333333333333334"}', now(), now(), now());
create function pg_temp.claims(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), pg_temp.claims(user_id)
$$;

-- Everything happens in one transaction, so every entry has the same time; order by kind instead.
create temp table t (guild uuid, week date, start_ms bigint, first uuid);
grant select, insert, update on t to authenticated;
insert into t (week, start_ms) values (date_trunc('week', now() at time zone 'UTC')::date + 7,
  (extract(epoch from now() + interval '8 days') * 1000)::bigint);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
update t set guild = public.create_guild(
  '{"name": "History", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}');
reset role;
insert into public.members (guild_id, id, name, discord_id, position)
  select guild, v.id, v.id, v.discord, v.position from t,
    (values ('m-ash', '922222222222222223', 1), ('m-bo', '933333333333333334', 2)) v(id, discord, position);

-- Writes below run as the database owner with the officer's identity, as apply_guild_changes does.
select pg_temp.claims('00000000-0000-0000-0000-0000000000e1');
insert into public.plans (guild_id, week, raid_id, start, team, locked, attendance, cancelled)
  select guild, week, 'raid-20', start_ms, '[{"memberId": "m-ash", "characterId": "c-ash", "role": "Tank"}]',
    '[]', '{}', false from t;
select is((select actor_name || ':' || kind || ':' || visibility from public.raid_history),
  'Sam:draft:officers', 'a new draft roster is recorded for officers, naming who made it');

update public.plans set team = team || '[{"memberId": "m-bo", "characterId": "c-bo", "role": "Healer"}]'
  where guild_id = (select guild from t);
update public.plans set team = '[{"memberId": "m-bo", "characterId": "c-bo", "role": "Healer"}]'
  where guild_id = (select guild from t);
select is((select count(*)::int from public.raid_history), 1, 'one officer’s quick edits merge into one change');
update t set first = (select id from public.raid_history);

-- An officer explains it; later edits start a new entry instead of rewriting the explained one.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$ select public.explain_raid_change((select guild from t), (select first from t),
  'Ash asked to sit out') $$, 'officers explain a change');
reset role;
select pg_temp.claims('00000000-0000-0000-0000-0000000000e1');
update public.plans set
  published = jsonb_build_object('start', start, 'end', start + 10800000, 'publishedAt', 1000, 'day', 1,
    'startSlot', 2, 'raidName', '20-player Raid', 'targets', '[2,4,14]'::jsonb, 'team', team)
  where guild_id = (select guild from t);
select is((select kind || ':' || visibility || ':' || array_to_string(affects, ',') from public.raid_history
  where kind = 'published'), 'published:members:m-bo', 'publishing is recorded for the players on it');

update public.plans set
  team = '[{"memberId": "m-ash", "characterId": "c-ash", "role": "Tank"}]',
  published = published || jsonb_build_object('publishedAt', 2000,
    'team', '[{"memberId": "m-ash", "characterId": "c-ash", "role": "Tank"}]'::jsonb)
  where guild_id = (select guild from t);
select is((select before->'team'->0->>'memberId' from public.raid_history
  where kind = 'published' and details->>'republished' = 'true'), 'm-bo',
  'a republication keeps the roster it replaced, for restoring');
select is((select count(*)::int from public.raid_history where kind = 'draft'), 2,
  'an explained change is not merged into later edits');

update public.plans set attendance = '{"m-ash": "noshow"}' where guild_id = (select guild from t);
select is((select details->'attendance'->'m-ash'->>'to' from public.raid_history where kind = 'attendance'),
  'noshow', 'attendance changes are recorded');
update public.plans set cancelled = true where guild_id = (select guild from t);

-- Players read only what concerns their own published place.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select is((select array_agg(kind order by kind) from public.get_raid_history((select guild from t),
  (select week from t), 'raid-20')), array['cancelled', 'published'],
  'Ash sees the republication and cancellation that include them, not drafts or attendance');
select is((select count(*)::int from public.get_raid_history((select guild from t), (select week from t), 'raid-20')
  where before is not null), 0, 'players never receive the restorable roster');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e3');
select is((select array_agg(kind order by kind) from public.get_raid_history((select guild from t),
  (select week from t), 'raid-20')), array['published', 'published'],
  'Bo sees being published and then left off');
select throws_ok($$ select public.explain_raid_change((select guild from t), (select first from t), 'x') $$,
  '42501', 'Only officers can explain a raid change.', 'players cannot explain changes');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select is((select count(*)::int from public.get_raid_history((select guild from t), (select week from t), 'raid-20')),
  6, 'officers read every change');
select is((select reason from public.get_raid_history((select guild from t), (select week from t), 'raid-20')
  where reason is not null), 'Ash asked to sit out', 'with the reason given');

select * from finish();
rollback;
