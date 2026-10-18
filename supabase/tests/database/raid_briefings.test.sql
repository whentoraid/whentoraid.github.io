-- Raid-day briefing: officers write it, members read it, links stay https, empty fields clear it, and
-- the posted Discord roster is refreshed with it. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000d2', 'ash@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'discord', '811111111111111113', '{"sub": "811111111111111113"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', 'discord', '822222222222222223', '{"sub": "822222222222222223"}', now(), now(), now());
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.officer() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1') $$;
create function pg_temp.ash() returns void language sql as $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2') $$;

-- Next week's raid, published and already posted to Discord.
create temp table t (guild uuid, week date, start_ms bigint, job uuid);
grant select, insert, update on t to authenticated;
insert into t (week, start_ms) values (date_trunc('week', now() at time zone 'UTC')::date + 7,
  (extract(epoch from now() + interval '8 days') * 1000)::bigint);
select pg_temp.officer();
update t set guild = public.create_guild(
  '{"name": "Briefings", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.members (guild_id, id, name, discord_id, position)
  select guild, 'm-ash', 'Ash', '822222222222222223', 1 from t;
insert into public.plans (guild_id, week, raid_id, start, team, locked, attendance, cancelled, published)
  select guild, week, 'raid-20', start_ms, '[]', '[]', '{}', false,
    jsonb_build_object('start', start_ms, 'end', start_ms + 10800000, 'publishedAt', 1000, 'day', 1,
      'startSlot', 2, 'raidName', '20-player Raid', 'targets', '[2,4,14]'::jsonb, 'team', '[]'::jsonb) from t;
insert into public.discord_deliveries (guild_id, delivery_key, week, raid_id, kind, payload, webhook_fingerprint,
    message_ids, status)
  select guild, 'roster:' || week || ':raid-20', week, 'raid-20', 'roster', '{}', 'bot', '["855555555555555555"]', 'sent'
  from t;
update t set job = (select id from public.discord_deliveries where guild_id = (select guild from t));

select pg_temp.ash();
select throws_ok($$ select public.set_raid_briefing((select guild from t), 'raid-20', 15, 'Stormwind', '', '', '') $$,
  '42501', 'Only officers can change the raid briefing.', 'players cannot write the briefing');

select pg_temp.officer();
select throws_ok($$ select public.set_raid_briefing((select guild from t), 'raid-20', 15, '', 'javascript:alert(1)', '', '') $$,
  '22023', 'The voice link must be a web address starting with https://.', 'only https voice links are kept');
select throws_ok($$ select public.set_raid_briefing((select guild from t), 'raid-20', 15, '', 'https://x.test/a)b', '', '') $$,
  '22023', 'The voice link must be a web address starting with https://.', 'a link that would break Discord markup is refused');
select throws_ok($$ select public.set_raid_briefing((select guild from t), 'raid-20', 500, '', '', '', '') $$,
  '22023', 'Meet up between 0 and 120 minutes before the start.', 'the meet-up lead time is bounded');
select lives_ok($$ select public.set_raid_briefing((select guild from t), 'raid-20', 15, '  Stormwind gates ',
  'https://discord.gg/abc123', 'Sam (whisper)', 'Bring flasks.') $$, 'officers write the briefing');
select lives_ok($$ select public.set_raid_week_note((select guild from t), (select week from t), 'raid-20',
  'Late start for the first pull.') $$, 'officers add a note for one week');
select throws_ok($$ select public.set_raid_week_note((select guild from t), (select week from t) + 1, 'raid-20', 'x') $$,
  '22023', 'Choose a raid week.', 'a week note belongs to a Monday week');

select pg_temp.ash();
select is(public.get_raid_briefings((select guild from t)) -> 'raids' -> 'raid-20',
  '{"assemblyMinutes": 15, "location": "Stormwind gates", "voiceUrl": "https://discord.gg/abc123",
    "contact": "Sam (whisper)", "notes": "Bring flasks."}'::jsonb, 'members read the trimmed briefing');
select is(public.get_raid_briefings((select guild from t)) -> 'notes' -> 0 ->> 'note',
  'Late start for the first pull.', 'and the week note');

reset role;
select set_config('request.jwt.claims', '', true);
select is((select status from public.discord_deliveries where id = (select job from t)), 'pending',
  'the posted roster is queued for an edit');
update public.discord_deliveries set status = 'sending', lease_token = '00000000-0000-0000-0000-00000000beef'
  where id = (select job from t);
select is(public.raid_roster_live_payload((select job from t), '00000000-0000-0000-0000-00000000beef') -> 'briefing',
  '{"assemblyMinutes": 15, "location": "Stormwind gates", "voiceUrl": "https://discord.gg/abc123",
    "contact": "Sam (whisper)", "notes": "Bring flasks.", "weekNote": "Late start for the first pull."}'::jsonb,
  'the Discord roster carries the briefing');

select pg_temp.officer();
select public.set_raid_briefing((select guild from t), 'raid-20', null, ' ', '', '', '');
select public.set_raid_week_note((select guild from t), (select week from t), 'raid-20', '');
select is(public.get_raid_briefings((select guild from t)), '{"raids": {}, "notes": []}'::jsonb,
  'empty fields clear the briefing');
reset role;
select set_config('request.jwt.claims', '', true);
select is(public.raid_roster_live_payload((select job from t), '00000000-0000-0000-0000-00000000beef') -> 'briefing',
  'null'::jsonb, 'a raid without a briefing posts none');

select pg_temp.ash();
select throws_ok($$ select public.raid_briefing_json((select guild from t), (select week from t), 'raid-20') $$,
  '42501', null, 'the internal summary is not callable by users');

select * from finish();
rollback;
