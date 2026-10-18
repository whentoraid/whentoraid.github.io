-- Joining from Discord. Anyone in a guild's linked Discord server becomes one of its players: when
-- they sign in to the app (the discord-join Edge Function asks Discord, with the bot token, whether
-- they are in the server and which roles they hold), or when they press a bot button or run /raid
-- there (Discord's signed interaction names them and their roles). Holding one of the guild's
-- officer roles makes them an officer. Roles only promote: losing the role in Discord does not
-- demote, so a mistyped role list cannot lock the officers out. Officers demote on Guild members.
-- Only the server recorded by discord-connect counts, never the editable guilds.discord_server_id.

-- Players an officer removed are not added back automatically. An officer adding them again, or the
-- player joining with an invite link, lifts this.
create table public.guild_removed_discord (
  guild_id uuid not null references public.guilds on delete cascade,
  discord_id text not null check (discord_id ~ '^\d{17,20}$'),
  removed_at timestamptz not null default now(),
  primary key (guild_id, discord_id)
);
alter table public.guild_removed_discord enable row level security;
revoke all on public.guild_removed_discord from public, anon, authenticated;

create function public.track_removed_discord() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A Discord ID taken off a player (deleted, or unlinked) is remembered, unless the whole guild
  -- is being deleted.
  if tg_op <> 'INSERT' and old.discord_id <> ''
     and (tg_op = 'DELETE' or new.discord_id is distinct from old.discord_id)
     and exists (select 1 from public.guilds g where g.id = old.guild_id) then
    insert into public.guild_removed_discord (guild_id, discord_id)
      values (old.guild_id, old.discord_id) on conflict do nothing;
  end if;
  if tg_op <> 'DELETE' and new.discord_id <> '' then
    delete from public.guild_removed_discord where guild_id = new.guild_id and discord_id = new.discord_id;
  end if;
  return null;
end $$;

create trigger members_track_removed_discord
  after insert or delete or update of discord_id on public.members
  for each row execute function public.track_removed_discord();

-- The Discord role IDs in a guild's comma-separated officer_role_ids.
create function public.officer_role_list(p_ids text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(r), '{}') from regexp_split_to_table(coalesce(p_ids, ''), '[,\s]+') r
  where r ~ '^\d{17,20}$'
$$;

-- Called only by the discord-join and raid-interactions Edge Functions, after Discord confirmed
-- that p_discord_id is in server p_server_id and holds p_role_ids there. Returns the ids of guilds
-- that gained the player or made them an officer.
create function public.join_from_discord(
  p_server_id text, p_discord_id text, p_name text, p_role_ids text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g uuid;
  officer boolean;
  display text := left(btrim(coalesce(p_name, '')), 30);
  changed uuid[] := '{}';
begin
  if coalesce(p_server_id, '') !~ '^\d{17,20}$' or coalesce(p_discord_id, '') !~ '^\d{17,20}$' then
    raise exception 'That is not a Discord server member.' using errcode = '22023';
  end if;
  if display = '' then display := 'Discord player'; end if;
  for g, officer in
    select s.guild_id, coalesce(public.officer_role_list(gu.officer_role_ids) && p_role_ids, false)
      from public.guild_discord_servers s join public.guilds gu on gu.id = s.guild_id
     where s.server_id = p_server_id
     order by s.guild_id
  loop
    -- Same lock order as atomic saves and join_guild.
    perform 1 from public.guild_revisions r where r.guild_id = g for update;
    if exists (select 1 from public.members m where m.guild_id = g and m.discord_id = p_discord_id) then
      update public.members m set is_officer = true
       where m.guild_id = g and m.discord_id = p_discord_id and officer and not m.is_officer;
    elsif exists (select 1 from public.guild_removed_discord x
                   where x.guild_id = g and x.discord_id = p_discord_id) then
      continue;
    else
      insert into public.members (guild_id, id, name, discord_id, is_officer, position)
        values (g, 'm-' || left(replace(gen_random_uuid()::text, '-', ''), 12), display, p_discord_id,
          officer, coalesce((select max(m.position) + 1 from public.members m where m.guild_id = g), 0));
    end if;
    if found then
      update public.guild_revisions set revision = revision + 1 where guild_id = g;
      changed := changed || g;
    end if;
  end loop;
  return jsonb_build_object('guildIds', to_jsonb(changed));
end $$;
revoke execute on function public.join_from_discord(text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.join_from_discord(text, text, text, text[]) to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261023120000'::text $$;
