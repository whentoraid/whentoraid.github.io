# Guild onboarding launch readiness

## First useful action

| Person      | Entry                             | First useful action                                | Current path                                                                                    |
| ----------- | --------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Guild owner | Sign in with Discord              | Connect the real server and post the first sign-up | Create guild → add bot → choose channel → choose weekly raid time → turn on sign-up posts       |
| Officer     | Sign in with Discord              | Review replies and prepare a roster                | Join from the connected server and an officer role → planner                                    |
| Member      | Sign in or open a personal invite | Answer a raid in Discord or the app                | Join from server or claim existing profile → add a character → answer availability or a sign-up |

These are action counts, not measured times. Time to first useful action needs a real owner, officer, and member run on the hosted build.

## Pain points addressed in the launch pass

| Pain                                                                           | Change                                                                                               | Check                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| Demo and browser setup distracted from joining a live guild                    | Discord sign-in is first; owner creation and demo are secondary                                      | Setup component and browser tests |
| A saved online demo could keep a person out of their real server               | Sign-in prefers the one real Discord guild over a saved demo and offers a clear switch from the demo | Remote sync and account tests     |
| A personal invite could lose an existing character profile to server auto-join | A pending invite takes precedence over automatic Discord joining                                     | Remote sync regression test       |
| A failed Discord membership check looked like an unlinked guild                | The error remains on screen with a retry action; missing bot configuration is reported as a failure  | Remote sync and account tests     |
| An owner returning from Discord could reopen the wrong online guild            | The return opens the guild that started the connection; a result for another guild is retained       | Discord connect and sync tests    |
| Officer access required copying raw IDs                                        | Connected officers choose roles by name; the ID field remains a fallback                             | Role listing and picker tests     |
| The owner had to enable `/raid` separately                                     | Bot linking installs the command; failure leaves a retry action                                      | Discord connect tests             |
| A bot-only channel hid the sign-up post setting                                | Sign-up controls appear for a bot channel, before reminders                                          | Settings and reminder UI          |
| The owner could enable sign-ups without a raid time                            | Connections points to the weekly schedule editor                                                     | Settings UI                       |
| Roster images duplicated the Discord card                                      | The roster stays in native Discord fields with names, spec icons, and controls together              | Roster and delivery tests         |

## Live launch gate

These items require the owner's real Discord server and a deployed build. Do them in order:

1. Deploy the app and the `discord-connect`, `discord-join`, `raid-interactions`, and `raid-dispatch` Edge Functions. Confirm the hosted schema matches the newest migration and the bot OAuth redirect and secrets are configured.
2. As the owner, create or choose the real online guild, connect the intended Discord server, select a roster channel, select officer roles by name, and set at least one weekly raid time. Check that `/raid help` appears. Turn on automatic sign-up posts and save.
3. As a new member in that server, sign in on a separate device or private session. Confirm that the real guild opens without an invite, add a character, answer a sign-up, and verify the answer appears in the app's responses.
4. As an officer with a selected Discord role, sign in on a separate account. Confirm planner access, publish a roster, and verify that the bot edits the right channel post. As the member, confirm the place and verify the app and Discord agree.
5. As an existing pre-created member, follow a personal invite. Confirm the existing characters and history remain attached and that no duplicate member appears.
6. Test an expired invite, a removed member, a missing bot permission, and a temporary Discord failure. Each must explain the recovery action without silently creating a second profile.

Record the time from link or sign-in to first answer, the number of people needing owner help, duplicate profiles, failed Discord checks, and the percentage of invited people who give an answer. A cohort is ready when the owner can complete the connection and the member and officer runs work without manual ID entry or unexplained reloads.

## Launch decisions

- **First answer: Discord sign-up posts.** Members answer the automatic sign-up post in the bot channel; that needs no app visit and is the path to announce. The app's availability grid stays available for members with complicated schedules and for officers planning ahead, but it is not the expected first step.
- Before turning on automatic posts, confirm the selected bot channel is the announcement channel members already read.
- Webhook posting stays under **Advanced: post with a webhook** and is untested on a real channel; the bot channel is the supported path for launch.

## Member announcement

Post this in the guild's Discord once automatic sign-up posts are on (edit the day and channel):

> **Raid sign-ups are moving to WhenToRaid.** Each week a sign-up post appears in #raid-signups. Press **Sign up**, **Late**, **Tentative** or **Absent** on it — that is all most of you need to do. Officers build the roster from those answers and the bot posts it in the same channel; press **Confirm** on the roster when you see your name. Want to add your characters or mark the times you can play? Sign in with Discord at https://whentoraid.github.io/ — you join the guild automatically from this server.

## Raid-week rehearsal

One real cycle before inviting the officers, with the owner and one test account. Reminders and automatic posts run on the scheduler, so this is the first check of timing, not just of buttons.

1. Back up first: `npm run db:backup` (see [OPERATIONS.md](OPERATIONS.md)).
2. In Guild settings, set the weekly raid time for a night this week and turn on automatic sign-up posts and reminders. Save.
3. Wait for the scheduler (it runs every five minutes): the sign-up post should appear in the bot channel on its schedule, without anyone pressing a button in the app.
4. Answer the sign-up from the test account in Discord; confirm the answer shows on the planner's Responses tab.
5. Build and publish the roster; confirm the bot posts it, then republish a change and confirm the same message is edited.
6. From the test account, report "can't make it"; offer the place to a standby player; accept it; put them in the draft and publish.
7. Let the reminder time pass and confirm the reminder arrives once.
8. After the raid, record attendance.
9. Run the weekly check in [OPERATIONS.md](OPERATIONS.md): no unexpected rows in `app_errors`, no `failed` or `uncertain` deliveries.

Write down anything that surprised you; each surprise is either a fix or a line in the member announcement.

## Hosted state, 2026-10-19

- The linked WhenToRaid Supabase project is healthy; local and hosted migrations matched at the time. The Discord bot secrets and all five Edge Functions are present, and the scheduler secret is set, so reminders and retries run.
- The only hosted guild is **Untitled Guild** (renamed on 2026-10-19), connected to the owner's Discord server. It was cleared to its owner alone for a fresh start: one member, one character, no raids, no sign-ups, no Discord posts. The browser demo guild was removed from the app.
- The real-Discord acceptance run (bot channel) passed every step on 2026-10-19; see [DISCORD_ACCEPTANCE_RUN.md](DISCORD_ACCEPTANCE_RUN.md).
- There is no weekly raid time yet, so automatic sign-up posts and reminders are idle until the rehearsal above.
