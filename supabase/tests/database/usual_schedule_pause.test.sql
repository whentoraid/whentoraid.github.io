-- Usual schedules that pause, end and are reviewed, and check-in reminders that count them as
-- answers. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create temp table s as select
  '{"timezone": "UTC", "fromWeek": "2026-10-05", "dayStartHour": 18, "slotsPerDay": 12, "slots": [1, 2]}'::jsonb as base;

-- Pausing and ending: what a week receives, and whether it is answered.
select is(public.template_for_week((select base || '{"pausedFrom": "2026-10-19", "pausedUntil": "2026-11-02"}' from s), '2026-10-12'),
  (select base from s), 'a week before the pause gets its times');
select is(public.template_for_week((select base || '{"pausedFrom": "2026-10-19", "pausedUntil": "2026-11-02"}' from s), '2026-10-26'),
  null, 'a paused week gets no times');
select ok(public.template_answers_week((select base || '{"pausedFrom": "2026-10-19"}' from s), '2027-03-01'),
  'an open-ended pause still answers, as away');
select is(public.template_for_week((select base || '{"pausedFrom": "2026-10-19", "pausedUntil": "2026-11-02"}' from s), '2026-11-02'),
  (select base from s), 'the resume week gets its times back');
select is(public.template_for_week((select base || '{"endWeek": "2026-10-26"}' from s), '2026-11-02'),
  null, 'after its last week the schedule fills nothing in');
select ok(not public.template_answers_week((select base || '{"endWeek": "2026-10-26"}' from s), '2026-11-02'),
  'and does not answer, so the member is asked again');
select is(public.template_for_week((select base || '{"confirmedAt": "2026-10-18", "reviewWeeks": 4}' from s), '2026-10-12'),
  (select base from s), 'review details are not part of what a week receives');
select is(public.template_for_week((select base || jsonb_build_object('pausedFrom', '2026-10-05',
    'previous', '{"timezone": "UTC", "fromWeek": "2026-09-07", "dayStartHour": 18, "slotsPerDay": 12, "slots": [3]}'::jsonb) from s), '2026-09-28'),
  '{"timezone": "UTC", "fromWeek": "2026-09-07", "dayStartHour": 18, "slotsPerDay": 12, "slots": [3]}'::jsonb,
  'weeks before a paused schedule still use the one it replaced');

-- Malformed details are refused.
select ok(public.valid_availability_template((select base || '{"pausedFrom": "2026-10-19", "pausedUntil": "2026-11-02",
  "endWeek": "2026-12-28", "confirmedAt": "2026-10-18", "reviewWeeks": 8}' from s)), 'well-formed details are accepted');
select ok(not public.valid_availability_template((select base || '{"pausedFrom": "2026-10-20"}' from s)), 'a pause starts on a Monday');
select ok(not public.valid_availability_template((select base || '{"pausedFrom": "2026-10-19", "pausedUntil": "2026-10-19"}' from s)),
  'a pause resumes after it starts');
select ok(not public.valid_availability_template((select base || '{"pausedUntil": "2026-10-19"}' from s)), 'a resume week needs a pause');
select ok(not public.valid_availability_template((select base || '{"endWeek": "2026-09-28"}' from s)), 'the last week is not before the first');
select ok(not public.valid_availability_template((select base || '{"reviewWeeks": 0}' from s)), 'reviews are at least a week apart');
select ok(not public.valid_availability_template((select base || '{"confirmedAt": "soon"}' from s)), 'a confirmation is a date');

-- Check-in reminders: a usual schedule answers the week unless it has ended; a saved check-in wins.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'officer@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'discord', '711111111111111111', '{"sub": "711111111111111111"}', now(), now(), now());
create temp table t (guild uuid, week date, delivery uuid, lease uuid);
grant select, insert, update on t to authenticated;
insert into t (week) values (date_trunc('week', now() at time zone 'UTC')::date);
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000e1", "role": "authenticated"}', true);
update t set guild = public.create_guild(
  '{"name": "Breaks", "timezone": "UTC", "dayStartHour": 18, "slotsPerDay": 12,
    "settings": {"raids": [{"id": "raid-20", "name": "20-player Raid", "size": 20, "targets": [2, 4, 14], "durationSlots": 6}], "checkinDeadline": null}}',
  '{"id": "m-officer", "name": "Sam"}');
reset role;
select set_config('request.jwt.claims', '', true);

insert into public.members (guild_id, id, name)
  select guild, id, id from t, unnest(array['m-usual', 'm-paused', 'm-ended', 'm-none', 'm-override']) id;
insert into public.availability_templates (guild_id, member_id, template)
  select guild, member, (select base from s) || jsonb_build_object('fromWeek', week - 14) || extra
  from t, (values ('m-usual', '{}'::jsonb), ('m-override', '{}'::jsonb),
    ('m-paused', jsonb_build_object('pausedFrom', (select week from t) - 7)),
    ('m-ended', jsonb_build_object('endWeek', (select week from t) - 7))) v(member, extra);
insert into public.checkins (guild_id, week, member_id, checked_in, ranges, declined)
  select guild, week, 'm-override', false, '[]', '[]' from t;
insert into public.raid_reminder_settings (guild_id, checkin_enabled) select guild, true from t;
update t set lease = gen_random_uuid();
insert into public.discord_deliveries (guild_id, delivery_key, week, kind, payload, webhook_fingerprint, status, lease_token)
  select guild, 'checkin:test', week, 'checkin', '{}', 'test', 'sending', lease from t;
update t set delivery = (select id from public.discord_deliveries where delivery_key = 'checkin:test' and guild_id = t.guild);

select is((select array_agg(r ->> 'name' order by r ->> 'name') from jsonb_array_elements(
    public.raid_reminder_payload((select delivery from t), (select lease from t)) -> 'recipients') r),
  array['Sam', 'm-ended', 'm-none', 'm-override'],
  'members whose usual schedule answers the week, paused included, are not reminded');

select * from finish();
rollback;
