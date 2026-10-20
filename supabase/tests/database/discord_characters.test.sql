begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- One guild on a Discord server, posting in one channel. Player 1 has a character; player 2 has none.
insert into public.guilds (id, name, timezone, day_start_hour, slots_per_day, discord_server_id, settings)
values ('00000000-0000-0000-0000-00000000d001', 'Character guild', 'UTC', 17, 14, '840000000000000001',
  jsonb_build_object('checkinDeadline', null, 'raids', jsonb_build_array(jsonb_build_object('id', 'raid-10',
    'name', 'Raid night', 'size', 4, 'targets', '[1,1,2]'::jsonb, 'durationSlots', 6))));
insert into public.members (guild_id, id, name, discord_id, is_officer, position)
select '00000000-0000-0000-0000-00000000d001', 'm-' || n, 'Player ' || n, '85000000000000000' || n, false, n
from generate_series(1, 2) n;
insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role, main, position)
values ('00000000-0000-0000-0000-00000000d001', 'c-1', 'm-1', 'Thrall', 'Whitemane', 'Restoration', 'Shaman',
  'Healer', true, 0);
insert into public.guild_discord_servers (guild_id, server_id)
values ('00000000-0000-0000-0000-00000000d001', '840000000000000001');
insert into public.guild_discord (guild_id, channel_id)
values ('00000000-0000-0000-0000-00000000d001', '860000000000000001');

create function pg_temp.list(who text) returns jsonb language sql as $$
  select public.discord_characters(who, '840000000000000001', '860000000000000001') $$;
create function pg_temp.add(who text, name text, realm text, class text, spec text, role text) returns jsonb
language sql as $$
  select public.add_character_from_discord(who, '840000000000000001', '860000000000000001', name, realm, class, spec, role) $$;
create function pg_temp.manage(who text, id text, action text) returns jsonb language sql as $$
  select public.manage_character_from_discord(who, '840000000000000001', '860000000000000001', id, action) $$;
create function pg_temp.revision() returns bigint language sql as $$
  select revision from public.guild_revisions where guild_id = '00000000-0000-0000-0000-00000000d001' $$;

-- Listing and the realm hint.
select is(pg_temp.list('850000000000000001') -> 'characters' -> 0 ->> 'name', 'Thrall', 'players see their characters');
select is(pg_temp.list('850000000000000002') -> 'characters', '[]'::jsonb, 'a new player has none');
select is(pg_temp.list('850000000000000002') ->> 'realm', 'Whitemane', 'a new player is offered the guild realm');
select is(pg_temp.list('859999999999999999'), '{"outcome":"not-member"}'::jsonb, 'strangers see nothing');
select is(public.discord_characters('850000000000000001', '849999999999999999', '860000000000000001'),
  '{"outcome":"not-member"}'::jsonb, 'membership cannot cross Discord servers');
select throws_ok($$ select pg_temp.list('not-a-snowflake') $$, '22023', null, 'malformed identity is rejected');

-- Adding.
create temp table before as select pg_temp.revision() as revision;
create temp table added as
  select pg_temp.add('850000000000000002', '  Hamuul ', ' Whitemane ', 'Druid', 'Feral Combat', 'Tank') as result;
select is((select result ->> 'outcome' from added), 'saved', 'a new player adds a character');
select ok((select (result -> 'character' ->> 'main')::boolean from added), 'their first character is their main');
select is((select row(name, realm, class, spec, role, main, retired)::text from public.characters
    where id = (select result -> 'character' ->> 'id' from added)),
  row('Hamuul', 'Whitemane', 'Druid', 'Feral Combat', 'Tank', true, false)::text, 'names and realms are trimmed');
select ok(pg_temp.revision() > (select revision from before), 'open apps are told to reload');
select is(pg_temp.add('850000000000000002', 'hamuul', 'WHITEMANE', 'Druid', 'Balance', 'DPS') -> 'character' ->> 'id',
  (select result -> 'character' ->> 'id' from added), 'a repeated submission returns the same character');
select is((select count(*)::int from public.characters where member_id = 'm-2'), 1, 'and adds no duplicate');
select is(pg_temp.add('850000000000000002', 'Jaina', 'Whitemane', 'Mage', 'Frost', 'DPS') -> 'character' ->> 'main',
  'false', 'later characters are alts');
select is(pg_temp.add('850000000000000002', 'Bad', 'Whitemane', 'Mage', 'Holy', 'Healer'),
  '{"outcome":"bad-spec"}'::jsonb, 'a spec the class cannot play is refused');
select is(pg_temp.add('850000000000000002', 'Bad', 'Whitemane', 'Druid', 'Feral Combat', 'Healer'),
  '{"outcome":"bad-spec"}'::jsonb, 'so is a role the spec cannot fill');
select is(pg_temp.add('850000000000000002', 'Bad', 'Whitemane', 'Monk', 'Brewmaster', 'Tank'),
  '{"outcome":"bad-spec"}'::jsonb, 'and a class that does not exist');
select throws_ok($$ select pg_temp.add('850000000000000002', '   ', 'Whitemane', 'Mage', 'Frost', 'DPS') $$,
  '22023', null, 'a blank name is rejected');
select throws_ok($$ select pg_temp.add('850000000000000002', repeat('x', 31), 'Whitemane', 'Mage', 'Frost', 'DPS') $$,
  '22023', null, 'a long name is rejected');
select is(pg_temp.add('859999999999999999', 'Ghost', 'Whitemane', 'Mage', 'Frost', 'DPS'),
  '{"outcome":"not-member"}'::jsonb, 'strangers cannot add characters');
insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role, position)
select '00000000-0000-0000-0000-00000000d001', 'bulk-' || n, 'm-1', 'Alt ' || n, 'Whitemane', 'Frost', 'Mage', 'DPS', 10 + n
from generate_series(1, 19) n;
select is(pg_temp.add('850000000000000001', 'One more', 'Whitemane', 'Mage', 'Frost', 'DPS'),
  '{"outcome":"too-many"}'::jsonb, 'the 20-character limit is explained');
delete from public.characters where id like 'bulk-%';

-- Choosing a main and deleting.
create temp table jaina as select id from public.characters where member_id = 'm-2' and name = 'Jaina';
select is(pg_temp.manage('850000000000000002', (select id from jaina), 'main') ->> 'outcome', 'saved', 'a player chooses a main');
select is((select string_agg(name, ',' order by name) from public.characters where member_id = 'm-2' and main),
  'Jaina', 'only one character is the main');
select is(pg_temp.manage('850000000000000001', (select id from jaina), 'main'),
  '{"outcome":"bad-character"}'::jsonb, 'players cannot change other players’ characters');
select is(pg_temp.manage('850000000000000002', (select id from jaina), 'retire') ->> 'outcome', 'saved',
  'a player deletes a character');
select ok((select retired and not main from public.characters where id = (select id from jaina)),
  'deleting retires the character, as the app does');
select ok((select main from public.characters where member_id = 'm-2' and name = 'Hamuul'),
  'the next character becomes the main');
select is(pg_temp.manage('850000000000000002', (select id from jaina), 'main'),
  '{"outcome":"bad-character"}'::jsonb, 'a deleted character cannot be changed');
select is(pg_temp.manage('850000000000000002', (select result -> 'character' ->> 'id' from added), 'retire'),
  '{"outcome":"only-character","name":"Hamuul"}'::jsonb, 'the only character cannot be deleted');
select throws_ok($$ select pg_temp.manage('850000000000000002', 'c-1', 'rename') $$, '22023', null,
  'unknown changes are rejected');

-- Only the Edge Function may call these.
set local role authenticated;
select throws_ok($$ select pg_temp.list('850000000000000001') $$, '42501', null, 'signed-in players cannot call them directly');
select throws_ok($$ select pg_temp.add('850000000000000001', 'X', 'Y', 'Mage', 'Frost', 'DPS') $$, '42501', null,
  'nor add characters directly');
set local role anon;
select throws_ok($$ select pg_temp.manage('850000000000000001', 'c-1', 'main') $$, '42501', null, 'nor can anonymous callers');
reset role;

select * from finish();
rollback;
