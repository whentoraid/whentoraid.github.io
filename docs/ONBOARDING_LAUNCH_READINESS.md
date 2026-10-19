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
| Roster image color covered the spec as well as the name                        | Status color is applied to the name in the roster image                                              | Roster model test                 |

## Live launch gate

These items require the owner's real Discord server and a deployed build. Do them in order:

1. Deploy the app and the `discord-connect`, `discord-join`, `raid-interactions`, and `raid-dispatch` Edge Functions. Confirm the hosted schema matches the newest migration and the bot OAuth redirect and secrets are configured.
2. As the owner, create or choose the real online guild, connect the intended Discord server, select a roster channel, select officer roles by name, and set at least one weekly raid time. Check that `/raid help` appears. Turn on automatic sign-up posts and save.
3. As a new member in that server, sign in on a separate device or private session. Confirm that the real guild opens without an invite, add a character, answer a sign-up, and verify the answer appears in the app's responses.
4. As an officer with a selected Discord role, sign in on a separate account. Confirm planner access, publish a roster, and verify that the bot edits the right channel post. As the member, confirm the place and verify the app and Discord agree.
5. As an existing pre-created member, follow a personal invite. Confirm the existing characters and history remain attached and that no duplicate member appears.
6. Test an expired invite, a removed member, a missing bot permission, and a temporary Discord failure. Each must explain the recovery action without silently creating a second profile.

Record the time from link or sign-in to first answer, the number of people needing owner help, duplicate profiles, failed Discord checks, and the percentage of invited people who give an answer. A cohort is ready when the owner can complete the connection and the member and officer runs work without manual ID entry or unexplained reloads.

## Remaining product choices

- Confirm the exact roster name color rule. The current image uses blue for confirmed players and yellow for backup offers.
- Decide whether the first cohort uses automatic sign-up posts, app availability, or both as the expected first answer. The interface supports both; the owner should announce one clear path to members.
- Choose the real Discord server and roster channel. No production guild or channel was changed during this local pass.

## Hosted audit, 2026-10-18

- The linked WhenToRaid Supabase project is healthy; local and hosted migrations match. The Discord bot secrets and all five Edge Functions are present.
- The only hosted guild is **Unsanctioned Minds**, connected to **Distracted Minds**. It has five Discord-linked members, two characters, an officer role selection, and a bot channel. It has no weekly raid time; automatic sign-up posts and reminders are off.
- Confirm that this existing server and channel are the intended launch destination before enabling posts. Preserve the existing guild and member history.
- GitHub CLI authentication is invalid, but a Git push dry run succeeds. The Pages workflow runs lint, unit, browser, database, integration, and hosted schema checks before publishing.
