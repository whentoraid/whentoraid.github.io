-- Member reminder preferences: who a reminder pings, quiet hours in the player's own timezone,
-- and the player-only functions that keep them. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'officer@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'discord', '711111111111111112', '{"sub": "711111111111111112"}', now(), now(), now());
create temp table t (guild uuid, week date, delivery uuid, lease uuid);
grant select, insert, update on t to authenticated;
insert into t (week) values (date_trunc('week', now() at time zone 'UTC')::date);
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000f1", "role": "authenticated"}', true);
update t set guild = public.create_guild(
  '{"name": "Pings", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}');

-- The signed-in player's own preferences.
select is(public.get_my_reminder_prefs((select guild from t)),
  '{"ping": true, "quiet_start": null, "quiet_end": null, "timezone": null}'::jsonb, 'no saved preference pings');
select throws_ok($$ select public.set_my_reminder_prefs((select guild from t), true, 1320, null, 'UTC') $$,
  '22023', 'Choose when quiet hours start and end.', 'quiet hours need both ends');
select throws_ok($$ select public.set_my_reminder_prefs((select guild from t), true, 600, 600, 'UTC') $$,
  '22023', 'Quiet hours need to end at a different time than they start.', 'quiet hours are not empty');
select throws_ok($$ select public.set_my_reminder_prefs((select guild from t), true, 1440, 60, 'UTC') $$,
  '22023', 'Choose quiet hours within a day.', 'quiet hours are within a day');
select throws_ok($$ select public.set_my_reminder_prefs((select guild from t), true, 1320, 480, 'Mars/Olympus') $$,
  '22023', 'Choose a known timezone.', 'the timezone is a real one');
select lives_ok($$ select public.set_my_reminder_prefs((select guild from t), true, 1320, 480, 'America/New_York') $$,
  'a player saves quiet hours');
select is(public.get_my_reminder_prefs((select guild from t)),
  '{"ping": true, "quiet_start": 1320, "quiet_end": 480, "timezone": "America/New_York"}'::jsonb,
  'and reads them back');
select ok(not has_function_privilege('authenticated', 'public.reminder_pings(uuid, text, timestamptz)', 'execute'),
  'players cannot ask about anyone else''s pings');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.get_my_reminder_prefs((select guild from t)) $$,
  '42501', 'Sign in as a member of this guild.', 'someone signed out has no preferences');

-- Quiet hours are read in the player's timezone, including windows past midnight.
-- 2026-10-19 03:00 UTC is 11:00 pm the evening before in New York.
select ok(not public.reminder_pings((select guild from t), 'm-officer', '2026-10-19 03:00+00'),
  'a reminder inside quiet hours that wrap midnight does not ping');
select ok(public.reminder_pings((select guild from t), 'm-officer', '2026-10-19 16:00+00'),
  'a reminder at noon pings');
select ok(public.reminder_pings((select guild from t), 'm-officer', '2026-10-19 12:00+00'),
  'quiet hours end when they say (8:00 am)');
update public.member_reminder_prefs set quiet_start = 540, quiet_end = 1020 where member_id = 'm-officer';
select ok(not public.reminder_pings((select guild from t), 'm-officer', '2026-10-19 17:00+00'),
  'a daytime window (9 am to 5 pm) is quiet at 1 pm');
select ok(public.reminder_pings((select guild from t), 'm-officer', '2026-10-19 23:00+00'),
  'and pings at 7 pm');
select ok(public.reminder_pings((select guild from t), 'm-nobody', now()), 'a player with no preference is pinged');

-- Reminder payloads carry each recipient's ping.
insert into public.members (guild_id, id, name, discord_id)
  select guild, id, id, discord from t, (values ('m-loud', '722222222222222222'), ('m-muted', '733333333333333333')) v(id, discord);
insert into public.member_reminder_prefs (guild_id, member_id, ping) select guild, 'm-muted', false from t;
update public.member_reminder_prefs set quiet_start = null, quiet_end = null, ping = false where member_id = 'm-officer';
insert into public.raid_reminder_settings (guild_id, checkin_enabled) select guild, true from t;
update t set lease = gen_random_uuid();
insert into public.discord_deliveries (guild_id, delivery_key, week, kind, payload, webhook_fingerprint, status, lease_token)
  select guild, 'checkin:prefs', week, 'checkin', '{}', 'test', 'sending', lease from t;
update t set delivery = (select id from public.discord_deliveries where delivery_key = 'checkin:prefs' and guild_id = t.guild);
select is((select array_agg((r ->> 'name') || ':' || (r ->> 'mention') order by r ->> 'name' collate "C") from jsonb_array_elements(
    public.raid_reminder_payload((select delivery from t), (select lease from t)) -> 'recipients') r),
  array['Sam:false', 'm-loud:true', 'm-muted:false'],
  'everyone who has not checked in is named, with whether to ping them');
delete from public.members where id = 'm-muted';
select is((select count(*)::int from public.member_reminder_prefs where member_id = 'm-muted'), 0,
  'a removed member''s preferences go with them');

select * from finish();
rollback;
