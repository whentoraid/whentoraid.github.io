-- Error reports: signed-in players can report but never read, fields are trimmed, each account is
-- capped per hour, old reports are dropped, and only the service role reports server errors.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'reporter@example.test', '{}');
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ select public.report_app_error(repeat('x', 900), 'at f (app.js:1)', 'planner', 'Test') $$,
  'a signed-in player can report an error');
select throws_ok($$ select * from public.app_errors $$, '42501', null, 'players cannot read reports');
select throws_ok($$ select public.report_server_error('raid-dispatch', 'boom') $$, '42501', null,
  'players cannot file server reports');
reset role;

select is((select char_length(message) from public.app_errors), 500, 'a long message is trimmed');
select is((select source || ':' || page || ':' || user_id::text from public.app_errors),
  'app:planner:00000000-0000-0000-0000-0000000000f1', 'the report names the app, page and account');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select public.report_app_error('again', null, 'home', null) from generate_series(1, 40);
reset role;
select is((select count(*)::int from public.app_errors), 30, 'one account stores at most 30 reports an hour');

set local role anon;
select throws_ok($$ select public.report_app_error('signed out', null, null, null) $$, '42501', null,
  'signed-out visitors cannot report');
reset role;

update public.app_errors set at = now() - interval '31 days';
set local role service_role;
select public.report_server_error('raid-dispatch', 'Discord said no');
reset role;
select is((select count(*)::int from public.app_errors), 1, 'reports older than 30 days are dropped');
select is((select source || ':' || message from public.app_errors), 'raid-dispatch:Discord said no',
  'the service role reports a server error');

select * from finish();
rollback;
