-- Character setup in Discord, for players who never open the website: /raid characters lists, adds,
-- chooses a main for, and deletes (retires) their characters, and a sign-up press from a player with
-- no characters adds one before signing up. Called only by the raid-interactions Edge Function;
-- identity comes from the signed interaction, never from an argument the player chose.

-- The guild a Discord player speaks for on this server: the one they belong to, preferring the guild
-- that posts in this channel (as discord_raid_overview resolves it). Returns the member's guild and id,
-- or an outcome: not-member, or ambiguous when two guilds on the server could be meant.
create function public.discord_member_for(p_discord_id text, p_discord_guild_id text, p_channel_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare candidates uuid[];
begin
  if coalesce(p_discord_id, '') !~ '^\d{17,20}$'
     or coalesce(p_discord_guild_id, '') !~ '^\d{17,20}$'
     or coalesce(p_channel_id, '') !~ '^\d{17,20}$' then
    raise exception 'Invalid Discord identity.' using errcode = '22023';
  end if;
  with memberships as (
    select gu.id, coalesce(d.channel_id = p_channel_id, false) as in_channel
    from public.guilds gu
    join public.guild_discord_servers ds on ds.guild_id = gu.id and ds.server_id = p_discord_guild_id
    join public.members me on me.guild_id = gu.id and me.discord_id = p_discord_id
    left join public.guild_discord d on d.guild_id = gu.id
    where gu.discord_server_id = ds.server_id
  )
  select array_agg(id order by id) into candidates from memberships
  where in_channel or not exists (select 1 from memberships where in_channel);
  if coalesce(cardinality(candidates), 0) = 0 then return '{"outcome":"not-member"}'; end if;
  if cardinality(candidates) <> 1 then return '{"outcome":"ambiguous"}'; end if;
  return (select jsonb_build_object('guildId', m.guild_id, 'memberId', m.id) from public.members m
    where m.guild_id = candidates[1] and m.discord_id = p_discord_id);
end $$;

-- The player's active characters, main first, and the realm to suggest for a new one: their main's,
-- else the realm most of the guild plays on.
create function public.discord_characters(p_discord_id text, p_discord_guild_id text, p_channel_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare who jsonb; g uuid; m text; realm text;
begin
  who := public.discord_member_for(p_discord_id, p_discord_guild_id, p_channel_id);
  if who ? 'outcome' then return who; end if;
  g := (who ->> 'guildId')::uuid;
  m := who ->> 'memberId';
  select c.realm into realm from public.characters c where c.guild_id = g and c.member_id = m and not c.retired
    order by c.main desc, c.position limit 1;
  if realm is null then
    select c.realm into realm from public.characters c where c.guild_id = g and not c.retired
      group by c.realm order by count(*) desc, c.realm limit 1;
  end if;
  return jsonb_build_object('outcome', 'ok', 'guildId', g, 'realm', realm,
    'guildName', (select gu.name from public.guilds gu where gu.id = g),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'realm', c.realm,
        'class', c.class, 'spec', c.spec, 'role', c.role, 'main', c.main) order by c.main desc, c.position)
      from public.characters c where c.guild_id = g and c.member_id = m and not c.retired), '[]'));
end $$;

-- Add a character. The player's first becomes their main. Adding a name and realm they already have
-- returns that character instead, so a repeated form submission cannot create a duplicate.
--
-- Outcomes: saved (with the character), too-many, bad-spec, not-member, ambiguous.
create function public.add_character_from_discord(
  p_discord_id text, p_discord_guild_id text, p_channel_id text,
  p_name text, p_realm text, p_class text, p_spec text, p_role text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare who jsonb; g uuid; m text; new_name text := btrim(p_name); new_realm text := btrim(p_realm);
  active_count int; c public.characters;
begin
  if coalesce(char_length(new_name), 0) not between 1 and 30
     or coalesce(char_length(new_realm), 0) not between 1 and 60
     or p_class is null or p_spec is null or p_role is null then
    raise exception 'Invalid character.' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.class_spec_roles(p_class)) x
      where x ->> 'spec' = p_spec and x ->> 'role' = p_role) then
    return jsonb_build_object('outcome', 'bad-spec');
  end if;
  who := public.discord_member_for(p_discord_id, p_discord_guild_id, p_channel_id);
  if who ? 'outcome' then return who; end if;
  g := (who ->> 'guildId')::uuid;
  m := who ->> 'memberId';
  -- Same lock order as atomic saves: an app saving meanwhile reloads instead of overwriting this.
  perform 1 from public.guild_revisions r where r.guild_id = g for update;

  select * into c from public.characters x where x.guild_id = g and x.member_id = m and not x.retired
    and lower(x.name) = lower(new_name) and lower(x.realm) = lower(new_realm) order by x.position limit 1;
  if found then
    return jsonb_build_object('outcome', 'saved', 'existing', true, 'guildId', g, 'character',
      jsonb_build_object('id', c.id, 'name', c.name, 'class', c.class, 'spec', c.spec, 'role', c.role, 'main', c.main));
  end if;
  select count(*) into active_count from public.characters x where x.guild_id = g and x.member_id = m and not x.retired;
  if active_count >= 20 then return jsonb_build_object('outcome', 'too-many'); end if;

  insert into public.characters (guild_id, id, member_id, name, realm, spec, class, role, main, position)
  values (g, gen_random_uuid()::text, m, new_name, new_realm, p_spec, p_class, p_role, active_count = 0,
    coalesce((select max(x.position) + 1 from public.characters x where x.guild_id = g), 0))
  returning * into c;
  update public.guild_revisions set revision = revision + 1 where guild_id = g;
  return jsonb_build_object('outcome', 'saved', 'guildId', g, 'character',
    jsonb_build_object('id', c.id, 'name', c.name, 'class', c.class, 'spec', c.spec, 'role', c.role, 'main', c.main));
end $$;

-- Make one of the player's characters their main, or delete it. Deleting retires the character, as
-- the app does: rosters and attendance keep it. The only active character cannot be deleted, and when
-- the main is deleted the next character becomes the main.
--
-- Outcomes: saved (with the character's name), only-character, bad-character, not-member, ambiguous.
create function public.manage_character_from_discord(
  p_discord_id text, p_discord_guild_id text, p_channel_id text, p_character_id text, p_action text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare who jsonb; g uuid; m text; c public.characters;
begin
  if coalesce(char_length(p_character_id), 0) not between 1 and 64 or p_action is null
     or p_action not in ('main', 'retire') then
    raise exception 'Invalid character change.' using errcode = '22023';
  end if;
  who := public.discord_member_for(p_discord_id, p_discord_guild_id, p_channel_id);
  if who ? 'outcome' then return who; end if;
  g := (who ->> 'guildId')::uuid;
  m := who ->> 'memberId';
  perform 1 from public.guild_revisions r where r.guild_id = g for update;
  select * into c from public.characters x
    where x.guild_id = g and x.id = p_character_id and x.member_id = m and not x.retired;
  if not found then return jsonb_build_object('outcome', 'bad-character'); end if;

  if p_action = 'main' then
    if c.main then return jsonb_build_object('outcome', 'saved', 'action', 'main', 'name', c.name); end if;
    update public.characters x set main = (x.id = c.id) where x.guild_id = g and x.member_id = m and not x.retired;
  else
    if (select count(*) from public.characters x where x.guild_id = g and x.member_id = m and not x.retired) = 1 then
      return jsonb_build_object('outcome', 'only-character', 'name', c.name);
    end if;
    update public.characters x set retired = true, main = false where x.guild_id = g and x.id = c.id;
    if c.main then
      update public.characters x set main = true where x.guild_id = g and x.id = (select y.id
        from public.characters y where y.guild_id = g and y.member_id = m and not y.retired order by y.position limit 1);
    end if;
  end if;
  update public.guild_revisions set revision = revision + 1 where guild_id = g;
  return jsonb_build_object('outcome', 'saved', 'action', p_action, 'name', c.name);
end $$;

revoke execute on function public.discord_member_for(text, text, text),
  public.discord_characters(text, text, text),
  public.add_character_from_discord(text, text, text, text, text, text, text, text),
  public.manage_character_from_discord(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.discord_characters(text, text, text),
  public.add_character_from_discord(text, text, text, text, text, text, text, text),
  public.manage_character_from_discord(text, text, text, text, text) to service_role;

create or replace function public.app_schema_version() returns text
language sql stable security invoker set search_path = '' as $$ select '20261104120000'::text $$;
