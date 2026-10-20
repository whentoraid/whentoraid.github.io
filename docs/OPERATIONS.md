# Running the hosted app

What to check, and how to recover, once real players use the hosted guild. Run the SQL in the
Supabase dashboard's SQL editor (or `npx supabase db query --linked`).

## Weekly check (two minutes)

**Errors from the app and the Edge Functions.** Uncaught errors in signed-in players' browsers
and failures in `raid-dispatch`, `raid-interactions`, `discord-connect`, `discord-join` and
`raid-calendar` land in `app_errors` and are kept for 30 days.

```sql
-- What broke, how often, and when it last happened.
select source, page, message, count(*) as times, max(at) as last_seen
from app_errors
where at > now() - interval '7 days'
group by source, page, message
order by last_seen desc;

-- The full stack trace of one message.
select at, page, user_agent, detail from app_errors where message like 'TypeError%' order by at desc limit 5;
```

A report names the page (`planner`, `home`, ...) but never the address, so it carries no sign-in
codes or invite links. Each account sends at most 30 reports an hour.

**Discord posts that did not go out.**

```sql
select guild_id, kind, action, week, raid_id, attempts, last_error, updated_at
from discord_deliveries
where status in ('failed', 'uncertain')
order by updated_at desc;
```

`uncertain` means the send was interrupted; check the channel before retrying from the app.

**Reminders and automatic sign-up posts.** These run only when the scheduler calls
`raid-dispatch`. If posts stop appearing on time, check the scheduler's recent runs and the
`raid-dispatch` logs in the dashboard (Edge Functions → raid-dispatch → Logs).

## Backups

The free Supabase plan keeps no backups you can download. Before each raid week (and before any
manual data change) save the data:

```sh
npm run db:backup
```

It writes `backups/whentoraid-<date>.sql`, which git ignores. Keep a few recent ones somewhere off
this machine as well; they contain Discord IDs and member names, so never commit or share them.

To restore into an empty database whose schema is already migrated:

```sh
psql "<connection string from the dashboard>" -f backups/whentoraid-<date>.sql
```

## Housekeeping

- Reset the database password (Project settings → Database) and update it wherever `supabase link`
  or the backup asks for it. Never paste it into chat or commit it.
- Push migrations before merging the code that needs them; the deploy refuses to publish when the
  hosted schema is behind (`app_schema_version()`).
