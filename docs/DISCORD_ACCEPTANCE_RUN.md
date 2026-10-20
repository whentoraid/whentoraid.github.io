# Discord acceptance run

Real-channel test of the online Discord lifecycle. Started October 16, 2026; steps C to H run October 19. **All steps pass.** One check is still open: in step E, that a cancelled raid's post buttons stop accepting answers. Confirm it before the November 4, 2026 release.

Test guild: bot channel in the **Distracted Minds** Discord server, no webhook. On 2026-10-19 the guild was reset to its owner alone (all other players, rosters, and history removed) and renamed **Untitled Guild**.

This is a historical test log. On October 18, the owner confirmed that test raids could be reset. Their tracked Discord posts and raid records were removed. Steps C onward run on new raid data: before step C, a roster was published to Discord again and confirmed from the post, so there was a live message to edit.

## Setup (done October 16)

- PR #27 merged; Edge Functions redeployed with `@supabase/supabase-js@2.117.2`.
- Vault `raid_dispatch_secret` and Edge secret `RAID_DISPATCH_SECRET` created (same random value). Before this, the 5-minute `raid-dispatch` cron job exited without calling anything, so reminders and automatic retries never ran.
- First scheduled call after the fix: 200 `{"results":[]}` at 23:55 UTC.

## Results

| Step | Action                                             | Result                                                                                                                                                                                               |
| ---- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Publish roster with "Also post to Discord"         | **Pass.** Week 2026-10-26 / `raid-20` posted as message `1560807477124141088`; delivery `sent` on attempt 1, ~4 s after publishing; recorded in `guild_discord.posts`.                               |
| B    | Click **Confirm**, then **Can't attend**           | **Pass.** Two interactions recorded once each; `raid_responses` ends `unavailable`, tied to publication `1792195897756`; app Responses tab matched.                                                  |
| C    | Change roster → **Publish draft changes**          | **Pass** (Oct 19). The same Discord message was edited, with no new post; the Responses tab no longer counted the earlier Confirm. Delivery `version` and `message_ids` not checked in the database. |
| D    | **Withdraw**, then publish again                   | **Pass** (Oct 19). The post showed "ROSTER WITHDRAWN", then the roster again after republishing. Not checked in the database.                                                                        |
| E    | **Cancel** the raid                                | **Pass for the post** (Oct 19). Ticking "Raid was cancelled" changed the Discord post to show the raid cancelled. Still to confirm: the post's buttons stop accepting answers.                       |
| F    | Turn on check-in and upcoming reminders            | **Pass** (Oct 19). With both reminders on, one check-in reminder and one upcoming-raid reminder posted once each, with no duplicates over later scheduler runs. Not checked in the database.         |
| G    | Calendar link: create, subscribe, change, turn off | **Pass** (Oct 19). The created link showed the published raid, reflected a republished change, and stopped working after **Turn off link**.                                                          |
| H    | Disconnected viewer                                | **Pass** (Oct 19). With the phone offline, a change published on desktop appeared on the phone after it reconnected, without a reload.                                                               |

After the run, also run the database and integration suites on the final revision (CI covers both). On October 19, CI's database job passed on `main` at `1b042d3` (PR #69), the revision the run used.

## Checking results

`npx supabase db query --linked "<sql>"` reads the hosted database. Useful queries:

- Deliveries: `select kind, action, status, attempts, version, message_ids, week, raid_id, last_error, updated_at from public.discord_deliveries order by updated_at desc limit 5`
- Scheduler calls: `select status_code, left(content,200), created from net._http_response order by created desc limit 3`
- Responses: `select week, raid_id, status, publication, updated_at from public.raid_responses order by updated_at desc limit 3`

Never select secret values; check only that `vault.secrets` names exist.

## Found during the run

- In a guild with no Discord channel, the Planner says so only inside the collapsed "Publication & sharing options", so it is easy to publish without noticing nothing will post. Show it next to the Publish button.
