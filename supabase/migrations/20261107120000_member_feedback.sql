-- Member-authored feedback, visible only to the guild's officers. No browsing events, screenshots,
-- URLs, raid notes, or session tokens are collected. Rollback: disable the Feedback entry point;
-- keep records for export, then remove the table/RPCs in a later forward migration if desired.
create table public.member_feedback (
  id uuid primary key,
  guild_id uuid not null references public.guilds on delete cascade,
  user_id uuid references auth.users on delete set null,
  message text not null check (char_length(message) between 1 and 2000),
  page text not null check (page in ('home', 'availability', 'characters', 'planner', 'officer', 'members', 'settings')),
  width integer not null check (width between 1 and 10000),
  height integer not null check (height between 1 and 10000),
  created_at timestamptz not null default now()
);
alter table public.member_feedback enable row level security;
revoke all on public.member_feedback from public, anon, authenticated;
create index member_feedback_guild on public.member_feedback (guild_id, created_at desc);
create index member_feedback_user on public.member_feedback (user_id, created_at desc);

create function public.send_member_feedback(p_id uuid, p_guild_id uuid, p_message text, p_page text,
  p_width integer, p_height integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare existing public.member_feedback;
begin
  if auth.uid() is null or not public.is_guild_member(p_guild_id) then
    raise exception 'Join a guild before sending feedback.' using errcode = '42501';
  end if;
  -- Serialize each account's rate limit without locking other members.
  perform id from auth.users where id = auth.uid() for update;
  select * into existing from public.member_feedback where id = p_id;
  if found then
    if existing.user_id is distinct from auth.uid() or existing.guild_id <> p_guild_id
        or existing.message <> btrim(p_message) or existing.page <> p_page
        or existing.width <> p_width or existing.height <> p_height then
      raise exception 'Choose a new feedback request.' using errcode = '22023';
    end if;
    return p_id;
  end if;
  if (select count(*) from public.member_feedback where user_id = auth.uid()
      and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Thanks for your feedback. Please wait before sending another report.' using errcode = '23514';
  end if;
  insert into public.member_feedback (id, guild_id, user_id, message, page, width, height)
    values (p_id, p_guild_id, auth.uid(), btrim(p_message), p_page, p_width, p_height);
  delete from public.member_feedback where created_at < now() - interval '90 days';
  return p_id;
end $$;

create function public.get_member_feedback(p_guild_id uuid)
returns table (id uuid, message text, page text, width integer, height integer, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_guild_officer(p_guild_id) then
    raise exception 'Only guild officers can read feedback.' using errcode = '42501';
  end if;
  return query select f.id, f.message, f.page, f.width, f.height, f.created_at
    from public.member_feedback f where f.guild_id = p_guild_id order by f.created_at desc limit 50;
end $$;
revoke execute on function public.send_member_feedback(uuid, uuid, text, text, integer, integer),
  public.get_member_feedback(uuid) from public, anon;
grant execute on function public.send_member_feedback(uuid, uuid, text, text, integer, integer),
  public.get_member_feedback(uuid) to authenticated;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261107120000'::text $$;
