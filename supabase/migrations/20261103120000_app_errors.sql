-- Error reports. Unexpected failures in the app (uncaught errors and rejected promises) and in the
-- Edge Functions are kept here for 30 days so the owner learns about them without waiting for
-- someone to mention it. Nobody reads the table through the API; the owner queries it from the
-- Supabase dashboard (see docs/OPERATIONS.md). Reports never carry tokens, addresses or form data:
-- the app sends the page name, the message and the stack, and the functions send their own message.

create table public.app_errors (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- 'app' for the browser, or the Edge Function's name.
  source text not null check (char_length(source) between 1 and 40),
  message text not null check (char_length(message) <= 500),
  detail text check (detail is null or char_length(detail) <= 4000),
  page text check (page is null or char_length(page) <= 40),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  -- Null for server reports. Kept when the account is deleted, without the link.
  user_id uuid references auth.users on delete set null
);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from public, anon, authenticated;
create index app_errors_at on public.app_errors (at desc);
create index app_errors_user on public.app_errors (user_id, at desc);

-- Stores one report, trimming every field to its limit, and drops reports older than 30 days.
create function public.store_app_error(p_source text, p_message text, p_detail text, p_page text,
    p_user_agent text, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_errors (source, message, detail, page, user_agent, user_id)
  values (left(coalesce(nullif(btrim(p_source), ''), 'unknown'), 40),
    left(coalesce(nullif(btrim(p_message), ''), 'Unknown error'), 500), left(p_detail, 4000),
    left(p_page, 40), left(p_user_agent, 300), p_user_id);
  delete from public.app_errors where at < now() - interval '30 days';
end $$;

-- A signed-in player's browser reports an error. A runaway page loop cannot fill the table: each
-- account stores at most 30 reports an hour and the rest are dropped without an error.
create function public.report_app_error(p_message text, p_detail text, p_page text, p_user_agent text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if (select count(*) from public.app_errors
      where user_id = auth.uid() and at > now() - interval '1 hour') >= 30 then
    return;
  end if;
  perform public.store_app_error('app', p_message, p_detail, p_page, p_user_agent, auth.uid());
end $$;

-- An Edge Function reports its own failure (service role only).
create function public.report_server_error(p_source text, p_message text) returns void
language sql security definer set search_path = '' as $$
  select public.store_app_error(p_source, p_message, null, null, null, null)
$$;

revoke execute on function public.store_app_error(text, text, text, text, text, uuid),
  public.report_app_error(text, text, text, text), public.report_server_error(text, text)
  from public, anon, authenticated;
grant execute on function public.report_app_error(text, text, text, text) to authenticated;
grant execute on function public.report_server_error(text, text) to service_role;

-- Keep in step with the newest migration's timestamp (checked by src/lib/schema-version.test.js).
create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261103120000'::text $$;
