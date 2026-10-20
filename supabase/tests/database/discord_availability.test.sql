begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- A guild planning 5 PM to midnight (14 half-hour slots) with no check-in deadline yet.
insert into public.guilds (id, name, timezone, day_start_hour, slots_per_day, discord_server_id, settings)
values ('00000000-0000-0000-0000-00000000e001', 'Schedule guild', 'UTC', 17, 14, '870000000000000001',
  jsonb_build_object('checkinDeadline', null, 'raids', jsonb_build_array(jsonb_build_object('id', 'raid-10',
    'name', 'Raid night', 'size', 4, 'targets', '[1,1,2]'::jsonb, 'durationSlots', 6))));
insert into public.members (guild_id, id, name, discord_id, is_officer, position)
select '00000000-0000-0000-0000-00000000e001', 'm-' || n, 'Player ' || n, '88000000000000000' || n, false, n
from generate_series(1, 2) n;
insert into public.guild_discord_servers (guild_id, server_id)
values ('00000000-0000-0000-0000-00000000e001', '870000000000000001');
insert into public.guild_discord (guild_id, channel_id)
values ('00000000-0000-0000-0000-00000000e001', '890000000000000001');

create temp table clock as select date_trunc('week', now() at time zone 'UTC')::date as week;
create function pg_temp.show(who text default '880000000000000001') returns jsonb language sql as $$
  select public.discord_availability(who, '870000000000000001', '890000000000000001') $$;
create function pg_temp.set(days int[], f int, t int, available boolean, dsh int default 17, spd int default 14,
  who text default '880000000000000001') returns jsonb language sql as $$
  select public.set_availability_from_discord(who, '870000000000000001', '890000000000000001', days, f, t, available, dsh, spd) $$;
create function pg_temp.stored(member text default 'm-1') returns jsonb language sql as $$
  select template from public.availability_templates where member_id = member
    and guild_id = '00000000-0000-0000-0000-00000000e001' $$;
create function pg_temp.revision() returns bigint language sql as $$
  select revision from public.guild_revisions where guild_id = '00000000-0000-0000-0000-00000000e001' $$;

-- Showing.
select is(pg_temp.show() ->> 'hasSchedule', 'false', 'a new player has no usual times');
select is((pg_temp.show() ->> 'week')::date, (select week from clock), 'with no deadline, changes start this week');
select is(pg_temp.show() -> 'dayStartHour', '17'::jsonb, 'the guild hours come along for the menus');
select is(pg_temp.show('889999999999999999'), '{"outcome":"not-member"}'::jsonb, 'strangers see nothing');

-- Saving: only the picked days change.
create temp table before as select pg_temp.revision() as revision;
select is(pg_temp.set('{1}', 4, 12, true) ->> 'outcome', 'saved', 'a player saves Tuesday 7 to 11 PM');
select is(pg_temp.stored() -> 'slots', '[18,19,20,21,22,23,24,25]'::jsonb, 'as Tuesday’s half-hour cells');
select is(pg_temp.stored() ->> 'fromWeek', (select week::text from clock), 'from this week');
select is(pg_temp.stored() ->> 'confirmedAt', (now() at time zone 'UTC')::date::text, 'confirmed today');
select ok(not pg_temp.stored() ? 'previous', 'with nothing to replace');
select ok(pg_temp.revision() > (select revision from before), 'open apps are told to reload');
select is(pg_temp.set('{3}', 4, 8, true) -> 'slots', '[18,19,20,21,22,23,24,25,46,47,48,49]'::jsonb,
  'adding Thursday keeps Tuesday, and the reply shows both');
select is(pg_temp.set('{1}', null, null, false) -> 'slots', '[46,47,48,49]'::jsonb, 'Tuesday can be marked not available');
select is(pg_temp.set('{3,5}', 0, 14, true) -> 'slots',
  '[42,43,44,45,46,47,48,49,50,51,52,53,54,55,70,71,72,73,74,75,76,77,78,79,80,81,82,83]'::jsonb,
  'several days take the same window, replacing what they had');
select ok(public.template_for_week(pg_temp.stored(), (select week from clock)) is not null, 'the planner reads it this week');

-- The schedule it replaces stays for earlier weeks, with the review interval carried over.
update public.availability_templates set template = jsonb_build_object('timezone', 'UTC',
  'fromWeek', (select week - 14 from clock), 'dayStartHour', 17, 'slotsPerDay', 14, 'slots', '[0,1]'::jsonb,
  'reviewWeeks', 4) where member_id = 'm-1';
select pg_temp.set('{6}', 2, 6, true);
select is(pg_temp.stored() #>> '{previous,fromWeek}', (select (week - 14)::text from clock), 'the old schedule is kept as previous');
select is(pg_temp.stored() -> 'reviewWeeks', '4'::jsonb, 'the review interval carries over');
select is(pg_temp.stored() -> 'slots', '[0,1,86,87,88,89]'::jsonb, 'Monday stays, Sunday is added');

-- After this week's check-ins close, changes start next week and this week keeps its times.
update public.guilds set settings = jsonb_set(settings, '{checkinDeadline}', '{"day": 0, "minutes": 0}')
where id = '00000000-0000-0000-0000-00000000e001';
create temp table closed as select public.template_for_week(pg_temp.stored(), (select week from clock)) as this_week;
select is((pg_temp.show() ->> 'week')::date, (select week + 7 from clock), 'a closed week moves changes to next week');
select is(pg_temp.set('{0}', null, null, false) ->> 'outcome', 'saved', 'and saving still works');
select is(pg_temp.stored() ->> 'fromWeek', (select (week + 7)::text from clock), 'from next week');
select is(public.template_for_week(pg_temp.stored(), (select week from clock)), (select this_week from closed),
  'this week keeps exactly the times it had');
select is(pg_temp.stored() -> 'slots', '[86,87,88,89]'::jsonb, 'next week drops Monday');
update public.guilds set settings = jsonb_set(settings, '{checkinDeadline}', 'null')
where id = '00000000-0000-0000-0000-00000000e001';

-- A week the player already answered keeps its answers.
insert into public.checkins (guild_id, week, member_id, checked_in, ranges)
select '00000000-0000-0000-0000-00000000e001', week, 'm-2', true, '[]' from clock;
select is(pg_temp.show('880000000000000002') ->> 'weekAnswered', 'true', 'an answered week is pointed out');

-- Menus drawn for other guild hours save nothing.
create temp table unchanged as select pg_temp.stored() as template;
select is(pg_temp.set('{2}', 0, 4, true, 18, 12), '{"outcome":"stale"}'::jsonb, 'stale menus are refused');
select is(pg_temp.stored(), (select template from unchanged), 'and change nothing');

-- A schedule saved under older guild hours is not shifted onto the new ones.
update public.availability_templates set template = jsonb_build_object('timezone', 'UTC',
  'fromWeek', (select week from clock), 'dayStartHour', 18, 'slotsPerDay', 12, 'slots', '[0,1,2]'::jsonb)
where member_id = 'm-1';
select is(pg_temp.show() ->> 'gridChanged', 'true', 'a schedule from old guild hours is flagged');
select is(pg_temp.show() -> 'slots', '[]'::jsonb, 'and not shown on the new hours');
select is(pg_temp.set('{4}', 0, 2, true) -> 'slots', '[56,57]'::jsonb, 'saving starts over on the new hours');

-- A schedule that has ended answers nothing, so it is neither shown nor carried forward.
update public.availability_templates set template = jsonb_build_object('timezone', 'UTC',
  'fromWeek', (select week - 14 from clock), 'endWeek', (select week - 7 from clock),
  'dayStartHour', 17, 'slotsPerDay', 14, 'slots', '[0,1]'::jsonb)
where member_id = 'm-1';
select is(pg_temp.show() ->> 'hasSchedule', 'false', 'an ended schedule is not shown as current');
select is(pg_temp.set('{1}', 0, 2, true) -> 'slots', '[14,15]'::jsonb, 'saving does not revive its other days');

-- Bad input.
select throws_ok($$ select pg_temp.set('{}', 0, 2, true) $$, '22023', null, 'no days is rejected');
select throws_ok($$ select pg_temp.set('{7}', 0, 2, true) $$, '22023', null, 'a day past Sunday is rejected');
select throws_ok($$ select pg_temp.set('{1,1}', 0, 2, true) $$, '22023', null, 'repeated days are rejected');
select throws_ok($$ select pg_temp.set('{1}', 4, 4, true) $$, '22023', null, 'an empty window is rejected');
select throws_ok($$ select pg_temp.set('{1}', 4, 15, true) $$, '22023', null, 'a window past the guild day is rejected');
select throws_ok($$ select pg_temp.set('{1}', null, 4, true) $$, '22023', null, 'a window needs a start');
select is(pg_temp.set('{1}', 0, 2, true, 17, 14, '889999999999999999'), '{"outcome":"not-member"}'::jsonb,
  'strangers cannot save');

-- Only the Edge Function may call these.
set local role authenticated;
select throws_ok($$ select pg_temp.show() $$, '42501', null, 'signed-in players cannot call them directly');
select throws_ok($$ select pg_temp.set('{1}', 0, 2, true) $$, '42501', null, 'nor save directly');
set local role anon;
select throws_ok($$ select pg_temp.show() $$, '42501', null, 'nor can anonymous callers');
reset role;

select * from finish();
rollback;
