begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.guilds (id, name, timezone, day_start_hour, slots_per_day, discord_server_id, officer_role_ids, settings)
select id::uuid, name, 'UTC', 17, 14, '810000000000000001', roles, jsonb_build_object('checkinDeadline', null,
  'raids', jsonb_build_array(jsonb_build_object('id','raid-10','name','Raid night','size',4,
    'targets','[1,1,2]'::jsonb,'durationSlots',6)))
from (values ('00000000-0000-0000-0000-00000000a001', 'Linked guild', '900000000000000001, 900000000000000002'),
  -- Claims the same server in its editable settings, but the bot was never added for it.
  ('00000000-0000-0000-0000-00000000a002', 'Unlinked guild', '900000000000000001')) t(id, name, roles);
insert into public.members (guild_id, id, name, discord_id, is_officer, position) values
  ('00000000-0000-0000-0000-00000000a001', 'm-officer', 'Officer', '820000000000000001', true, 0),
  ('00000000-0000-0000-0000-00000000a001', 'm-player', 'Player', '820000000000000002', false, 1),
  ('00000000-0000-0000-0000-00000000a002', 'm-officer', 'Officer', '820000000000000001', true, 0);
insert into public.guild_discord_servers (guild_id, server_id) values
  ('00000000-0000-0000-0000-00000000a001', '810000000000000001');

create function pg_temp.join_as(who text, name text default 'Newcomer', roles text[] default '{}',
  server text default '810000000000000001') returns jsonb language sql as $$
  select public.join_from_discord(server, who, name, roles)
$$;
create function pg_temp.revision() returns bigint language sql as $$
  select revision from public.guild_revisions where guild_id = '00000000-0000-0000-0000-00000000a001'
$$;
create function pg_temp.member(who text, g uuid default '00000000-0000-0000-0000-00000000a001')
returns public.members language sql as $$
  select * from public.members where guild_id = g and discord_id = who
$$;
create temp table before as select pg_temp.revision() as revision;

select is(pg_temp.join_as('820000000000000003', '  Newcomer  ') -> 'guildIds',
  '["00000000-0000-0000-0000-00000000a001"]'::jsonb, 'a server member joins the linked guild');
select is((pg_temp.member('820000000000000003')).name, 'Newcomer', 'the Discord name is trimmed');
select ok(not (pg_temp.member('820000000000000003')).is_officer, 'without an officer role they join as a player');
select is((pg_temp.member('820000000000000003')).position, 2, 'new players are listed last');
select is(pg_temp.revision(), (select revision + 1 from before), 'joining bumps the revision so open pages reload');
select ok((pg_temp.member('820000000000000003', '00000000-0000-0000-0000-00000000a002')).id is null,
  'a guild without a bot link cannot claim the server');

select is(pg_temp.join_as('820000000000000003') -> 'guildIds', '[]'::jsonb, 'joining again changes nothing');
select is(pg_temp.revision(), (select revision + 1 from before), 'an unchanged join leaves the revision alone');
select is(pg_temp.join_as('829999999999999999', 'Elsewhere', '{}', '819999999999999999') -> 'guildIds',
  '[]'::jsonb, 'another server joins nothing');

select is(pg_temp.join_as('820000000000000004', 'Raid lead', '{900000000000000002,900000000000000099}') -> 'guildIds',
  '["00000000-0000-0000-0000-00000000a001"]'::jsonb, 'an officer-role holder joins');
select ok((pg_temp.member('820000000000000004')).is_officer, 'holding an officer role makes them an officer');
select is(pg_temp.join_as('820000000000000002', 'Player', '{900000000000000001}') -> 'guildIds',
  '["00000000-0000-0000-0000-00000000a001"]'::jsonb, 'an existing player who gains the role is promoted');
select ok((pg_temp.member('820000000000000002')).is_officer, 'the promotion is saved');
select is(pg_temp.join_as('820000000000000001', 'Officer', '{}') -> 'guildIds', '[]'::jsonb,
  'an officer without the role is not demoted');
select ok((pg_temp.member('820000000000000001')).is_officer, 'officers keep their access');

select pg_temp.join_as('820000000000000005', '');
select is((pg_temp.member('820000000000000005')).name, 'Discord player', 'a blank name gets a placeholder');
select pg_temp.join_as('820000000000000006', repeat('x', 40));
select is(char_length((pg_temp.member('820000000000000006')).name), 30, 'long names fit the 30-character limit');

delete from public.members where guild_id = '00000000-0000-0000-0000-00000000a001' and discord_id = '820000000000000003';
select is(pg_temp.join_as('820000000000000003') -> 'guildIds', '[]'::jsonb, 'a removed player is not added back');
select ok((pg_temp.member('820000000000000003')).id is null, 'the removed player stays out');
update public.members set discord_id = '820000000000000007'
  where guild_id = '00000000-0000-0000-0000-00000000a001' and discord_id = '820000000000000005';
select is(pg_temp.join_as('820000000000000005') -> 'guildIds', '[]'::jsonb, 'an unlinked Discord ID is not added back');
insert into public.members (guild_id, id, name, discord_id) values
  ('00000000-0000-0000-0000-00000000a001', 'm-back', 'Back again', '820000000000000003');
select ok(not exists (select 1 from public.guild_removed_discord where discord_id = '820000000000000003'),
  'an officer adding the player again lifts the block');

select throws_ok($$ select pg_temp.join_as(null) $$, '22023', null, 'a missing Discord ID is rejected');
select throws_ok($$ select pg_temp.join_as('820000000000000008', 'x', '{}', 'nope') $$, '22023', null,
  'a malformed server ID is rejected');
select ok(not has_function_privilege('authenticated', 'public.join_from_discord(text, text, text, text[])', 'execute'),
  'signed-in players cannot add themselves to arbitrary guilds');
select ok(not has_function_privilege('anon', 'public.join_from_discord(text, text, text, text[])', 'execute'),
  'anonymous callers cannot join anyone');
select ok(not has_table_privilege('authenticated', 'public.guild_removed_discord', 'select'),
  'the removal list is private');

delete from public.guilds where id = '00000000-0000-0000-0000-00000000a001';
select ok(not exists (select 1 from public.guild_removed_discord where guild_id = '00000000-0000-0000-0000-00000000a001'),
  'deleting a guild leaves no removal records behind');

select * from finish();
rollback;
