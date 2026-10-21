-- Atomic web answers, authorization, deadline parity, retry/Undo and feedback privacy.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'officer@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', 'player@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000f3', 'outsider@example.test', '{}');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'discord', '811111111111111111', '{"sub":"811111111111111111"}', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', 'discord', '822222222222222222', '{"sub":"822222222222222222"}', now(), now(), now());
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;
create temp table t (guild uuid, week date, start_ms bigint, request uuid, result jsonb, snapshot jsonb, revision bigint);
grant all on t to authenticated;
insert into t (week, start_ms, request) values (date_trunc('week', now() at time zone 'UTC')::date,
  (extract(epoch from now() + interval '3 hours') * 1000)::bigint, gen_random_uuid());
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
update t set guild = public.create_guild(
  '{"name":"Member experience", "timezone":"UTC", "dayStartHour":0, "slotsPerDay":48,
    "settings":{"raids":[{"id":"raid-20","name":"Raid","size":20,"targets":[2,4,14],"durationSlots":6}],
    "checkinDeadline":{"day":0,"minutes":0}}}', '{"id":"m-officer","name":"Sam"}');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.members (guild_id, id, name, discord_id, position)
  select guild, 'm-player', 'Player', '822222222222222222', 1 from t;
insert into public.characters (guild_id,id,member_id,name,realm,class,spec,role,main,retired,position)
  select guild, 'c-main', 'm-player', 'Starfall', 'Whitemane', 'Mage', 'Frost', 'DPS', true, false, 0 from t;
insert into public.characters (guild_id,id,member_id,name,realm,class,spec,role,main,retired,position)
  select guild, 'c-alt', 'm-player', 'Mender', 'Whitemane', 'Priest', 'Holy', 'Healer', false, false, 1 from t;
insert into public.plans (guild_id,week,raid_id,start,team,locked,attendance,cancelled,published)
  select guild, week, 'raid-20', start_ms, '[]', '[]', '{}', false,
    jsonb_build_object('start',start_ms,'end',start_ms+10800000,'team','[]'::jsonb,'publishedAt',1,
      'day',0,'startSlot',0,'raidName','Raid','targets','[2,4,14]'::jsonb) from t;
insert into public.availability_templates (guild_id, member_id, template)
  select guild, 'm-player', jsonb_build_object('timezone','UTC','dayStartHour',0,'slotsPerDay',48,
    'fromWeek',week,'slots',jsonb_build_array(0,1)) from t;
create function pg_temp.checkin() returns jsonb language sql security definer as $$
  select to_jsonb(c) from public.checkins c where guild_id=(select guild from t) and member_id='m-player'
$$;
create function pg_temp.signup() returns jsonb language sql security definer as $$
  select to_jsonb(s) from public.raid_signups s where guild_id=(select guild from t) and member_id='m-player'
$$;
create function pg_temp.revision() returns bigint language sql security definer as $$
  select revision from public.guild_revisions where guild_id=(select guild from t)
$$;
create function pg_temp.deadline() returns timestamptz language sql security definer as $$
  select public.checkin_deadline(guild,week) from t
$$;
create function pg_temp.ranges(value jsonb) returns int8multirange language sql security definer as $$ select public.ranges_to_multirange(value) $$;
create function pg_temp.answer(status text, request uuid) returns jsonb language sql as $$
  select public.answer_raid(guild,week,'raid-20',$1,'c-alt','Shadow','DPS',$2) from t
$$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select ok(pg_temp.deadline() <= now(), 'weekly deadline has passed');
update t set result = pg_temp.answer('late',request), revision = pg_temp.revision();
select is((select result->'signup'->>'status' from t),'late','Late remains available after weekly deadline');
select is(pg_temp.signup()->>'character_id','c-alt','event-specific character saved');
select is(pg_temp.signup()->>'spec','Shadow','event-specific spec saved without changing character default');
select is((pg_temp.signup()->>'after_deadline')::boolean,true,'late entry flag recorded');
select is(pg_temp.checkin()->'raid_preferences'->'raid-20'->'signedAs'->>'spec','Shadow','checkin and signup use same spec');
select ok(pg_temp.ranges(pg_temp.checkin()->'ranges') @> (select start_ms from t),'checkin includes raid time');
select ok(pg_temp.ranges(pg_temp.checkin()->'ranges') @>
  (extract(epoch from (select week from t)::timestamp at time zone 'UTC')*1000)::bigint,'usual schedule preserved when materializing week');
update t set revision = pg_temp.revision();
select is(pg_temp.answer('late',(select request from t)),(select result from t),'lost-response retry returns identical result');
select is(pg_temp.revision(),(select revision from t),'retry creates no additional revision or side effect');
select throws_ok($$ select pg_temp.answer('signed',(select request from t)) $$,'22023',null,'same request cannot change its answer');
select throws_ok($$ select public.write_raid_answer_checkin((select guild from t),(select week from t),'m-player',pg_temp.checkin()) $$,
  '42501',null,'member cannot invoke private deadline bypass');
select throws_ok($$ insert into public.raid_answer_write_guard values (txid_current(),'{}',false) $$,
  '42501',null,'member cannot forge deadline capability');
select throws_ok($$ select public.apply_guild_changes((select guild from t),pg_temp.revision(),
  jsonb_build_array(jsonb_build_object('table','checkins','kind','upsert','rows',jsonb_build_array(
    pg_temp.checkin() || '{"ranges":[]}'::jsonb)))) $$,'23514',null,'ordinary weekly edits still enforce deadline');
select lives_ok($$ select public.undo_raid_answer((select request from t)) $$,'Undo works after weekly deadline');
select is(pg_temp.checkin(),null::jsonb,'Undo restores absent checkin so usual schedule remains inherited');
select is(pg_temp.signup(),null::jsonb,'Undo restores absent signup');
select lives_ok($$ select public.undo_raid_answer((select request from t)) $$,'Undo itself is idempotent');
select throws_ok($$ select pg_temp.answer('late',(select request from t)) $$,'23514',null,'retry cannot resurrect an undone answer');
update t set request=gen_random_uuid();
update t set result=pg_temp.answer('tentative',request);
select ok(pg_temp.ranges(pg_temp.checkin()->'availability'->'tentative') @> (select start_ms from t),'tentative availability saved');
select ok(not(pg_temp.ranges(pg_temp.checkin()->'ranges') @> (select start_ms from t)),'tentative is not firm');
update t set snapshot=pg_temp.checkin();
select throws_ok($$ select public.answer_raid(guild,week,'raid-20','signed','c-alt','Frost','DPS',gen_random_uuid()) from t $$,
  '22023',null,'invalid spec rejected');
select is(pg_temp.checkin(),(select snapshot from t),'failed answer leaves checkin unchanged');
select is(pg_temp.signup()->>'status','tentative','failed answer leaves signup unchanged');

-- A failure after writing the checkin must roll back the entire operation.
reset role;
create function pg_temp.fail_signup() returns trigger language plpgsql as $$ begin raise exception 'injected signup failure'; end $$;
create trigger injected_failure before update on public.raid_signups for each row execute function pg_temp.fail_signup();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select pg_temp.answer('signed',gen_random_uuid()) $$,'P0001','injected signup failure','second write failure is surfaced');
select is(pg_temp.checkin(),(select snapshot from t),'second write failure rolls back first write');
reset role;
drop trigger injected_failure on public.raid_signups;
select set_config('request.jwt.claims', '', true);
update public.checkins set availability='{"absent":[]}' where guild_id=(select guild from t);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select public.undo_raid_answer((select request from t)) $$,'40001',null,'Undo will not overwrite later availability edits');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
select throws_ok($$ select pg_temp.answer('signed',gen_random_uuid()) $$,'42501',null,'outsider cannot answer');
select throws_ok($$ select public.undo_raid_answer((select request from t)) $$,'42501',null,'another account cannot undo');
reset role;
select set_config('request.jwt.claims', '', true);
update public.plans set published=null where guild_id=(select guild from t);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select pg_temp.answer('signed',gen_random_uuid()) $$,'23514',null,'private draft without recurring schedule cannot be answered');
reset role;
select set_config('request.jwt.claims', '', true);
update public.plans set published=jsonb_build_object('start',(extract(epoch from now())*1000)::bigint-1,
  'end',(extract(epoch from now())*1000)::bigint+10800000,'team','[]'::jsonb,'publishedAt',1,
  'day',0,'startSlot',0,'raidName','Raid','targets','[2,4,14]'::jsonb) where guild_id=(select guild from t);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select pg_temp.answer('signed',gen_random_uuid()) $$,'23514',null,'raid answers close at raid start');

-- Feedback is an explicit member submission, private to officers, safely retryable.
update t set request=gen_random_uuid();
select is(public.send_member_feedback((select request from t),(select guild from t),'  Confusing time  ','availability',390,844),
  (select request from t),'member can submit feedback');
select lives_ok($$ select public.send_member_feedback(request,guild,'Confusing time','availability',390,844) from t $$,'feedback retry is idempotent');
select throws_ok($$ select public.send_member_feedback(request,guild,'Different','availability',390,844) from t $$,'22023',null,'request ID cannot be reused with different feedback');
select throws_ok($$ select * from public.get_member_feedback((select guild from t)) $$,'42501',null,'ordinary members cannot read feedback');
select throws_ok($$ select * from public.member_feedback $$,'42501',null,'table cannot be read directly');
select throws_ok($$ select public.send_member_feedback(gen_random_uuid(),guild,'','home',390,844) from t $$,'23514',null,'blank feedback rejected');
select throws_ok($$ select public.send_member_feedback(gen_random_uuid(),guild,'message','https://secret.example',390,844) from t $$,'23514',null,'arbitrary URL context rejected');
select public.send_member_feedback(gen_random_uuid(),guild,'Report '||n,'home',390,844) from t,generate_series(1,4) n;
select throws_ok($$ select public.send_member_feedback(gen_random_uuid(),guild,'sixth','home',390,844) from t $$,'23514',null,'feedback rate limit enforced');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
select throws_ok($$ select public.send_member_feedback(gen_random_uuid(),guild,'hi','home',390,844) from t $$,'42501',null,'outsider cannot submit to guild');
select throws_ok($$ select * from public.get_member_feedback((select guild from t)) $$,'42501',null,'outsider cannot read guild feedback');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.get_member_feedback((select guild from t))),5,'officer can read guild reports');
select ok(not (select to_jsonb(f) ? 'user_id' from public.get_member_feedback((select guild from t)) f limit 1),'officer response omits account ID');
reset role;
select is((select count(*)::int from public.raid_answer_write_guard),0,'private write capability never remains after requests');
select * from finish();
rollback;
