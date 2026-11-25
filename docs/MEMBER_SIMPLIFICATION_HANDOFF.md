# Guild member experience simplification: implementation handoff

**Status:** In progress
**Product direction:** User request and Codex recommendation
**Implementation lead:** Codex (current checkpoint); Claude can continue from the resume note
**Product and code review:** Codex
**Scope:** Member-facing experience. Preserve officer workflows and the existing design system.

This is the working contract for the guild member simplification discussed with the user. It expands [the product review](MEMBER_SIMPLIFICATION.md) into implementation behavior, data constraints, acceptance criteria, and a review packet. It supersedes older member-flow suggestions where they conflict with this scope. The historical [usability and onboarding plan](USABILITY_AND_ONBOARDING_PLAN.md) and [UI overhaul contract](UI_OVERHAUL.md) remain useful context; check their status before redoing work. The current onboarding tutorial is already implemented and must be adapted, not recreated.

## Capability

- **Primary actor:** A guild member, usually a raider answering upcoming raids or setting availability.
- **Outcome:** A member can tell what needs action, answer an announced raid quickly, maintain a weekly or usual schedule with the editor they prefer, and find occasional account and history tasks in one predictable Profile area.
- **Success signal:** Members can distinguish unanswered raids from availability and published roster commitments. They can complete common tasks without navigating officer tools or losing existing schedule, character, signup, confirmation, or reminder data.
- **Evidence limit:** The review reproduced incorrect status examples with existing pure model functions. It did not include observed user testing or timing data. Treat the recommendations below as product direction, then validate the implemented flows at the stated screen sizes and roles.

## Product intent and fixed constraints

1. Simplify the member experience around **Raids**, **Schedule**, and **Profile**. Keep officer tools and permissions intact.
2. Preserve **Paint grid** as a visible, first-class way to set times for both This week and Usual schedule. Keep Enter times available as an equal alternative. A usual schedule must not force range entry.
3. Reduce choices shown by default, while retaining existing advanced capabilities and stored data where their behavior still matters. Make advanced controls discoverable when needed; do not silently discard data.
4. Keep the distinction between availability, an explicit per-raid response, and a published roster assignment/confirmation. Do not imply that one answers the others.
5. Preserve the existing dark Warcraft visual identity, class colors, shared design tokens, published snapshot behavior, permissions, guild time-zone rules, recovery behavior, and keyboard/touch accessibility. No new UI framework or dependency is assumed.
6. Preserve working Discord signup flows. A member who can answer in Discord must not be forced into the app for an ordinary answer. Keep app and Discord statuses consistent.
7. Do not auto-confirm a roster spot from usual availability, tentative availability, or a broad schedule match. Automatic confirmation is explicitly deferred; the first redesign keeps the confirmation step.
8. Treat this as the complete member simplification scope below. The sequencing is implementation order, not authorization to omit later work or ship a reduced â€œMVPâ€ without the user revising scope.

### Product recommendations versus unresolved implementation questions

The three destinations, compact chronological raid list, common schedule editor, simplified default choices, and Profile grouping are product recommendations accepted for implementation. Claude may improve the visual arrangement if all behavior and acceptance criteria remain true.

The current data model cannot reliably tell whether every legacy empty schedule means â€œaway,â€ â€œnot entered,â€ or â€œdeclined an individual raid.â€ Do not infer or backfill whole-week absence from empty ranges. Use neutral copy such as **No available times saved** for ambiguous legacy state. If the implementation proposes a new provenance field, first trace every writer and reader, local/offline persistence, Discord, remote rows, validation, and migration/rollback needs. A data-model change must have explicit tests and explanation in the handoff report.

Usual schedule templates currently persist firm time ranges only. Preferred and tentative ranges are weekly data, not recurring-template data. Keep those distinctions visible and never claim they repeat with a usual schedule unless persistence is deliberately extended end-to-end and tested.

## Actors and surfaces

| Surface              | Member purpose                                                                     | Expected behavior                                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Raids**            | Answer announced raids, review assignments, confirm a place, act on standby offers | One chronological feed for the current and near-future announced raids; compact completed answers; action-needed states are clear. List and Calendar are two views of the same member-visible raid information. |
| **Schedule**         | Set available times for this week or a recurring usual schedule                    | One scope-aware editor with visible Paint grid / Enter times choice. Clear save behavior and concise advanced controls.                                                                                         |
| **Profile**          | Manage characters and less frequent personal tasks                                 | Characters/default, history/fairness, reminders/quiet hours, calendar subscription, account/guild switching, help, and tutorial replay.                                                                         |
| **Discord**          | Answer or change an ordinary raid response                                         | Existing command/post flow remains usable and displays the same canonical answer as the app. No app-only requirement for routine Discord responders.                                                            |
| **Officer surfaces** | Plan raids, publish and manage rosters, configure guild                            | Remain role-gated and functionally unchanged. Member simplification must not grant access or leak drafts.                                                                                                       |

Keep old deep links and bookmarks working. If a destination is renamed or moved, preserve a route alias/redirect and query/hash state. Existing `#/characters`, `#/availability`, published roster links, invite joins, and guild context must continue to land on the right member task.

## State and interaction contract

### Raids: one coherent feed

- Show a bounded horizon, with the current guild week and the next few weeks as a reasonable default; allow a member to load further dates. Avoid fetching an unbounded future on each render.
- Include explicitly announced future dates even when they are outside the current week. Clearly distinguish an announced/scheduled raid from a published assignment. Never expose officer-only draft times.
- Provide **List / Calendar** as alternate views over the same announced, member-visible raids. Calendar browsing and the private calendar subscription are different features.
- The same raid entry should progress through the applicable states: loading/error; unanswered; answered (I'm in / Maybe / Can't make it); waiting for roster; assigned and requiring confirmation; confirmed; or changed/cancelled. Do not show incompatible primary buttons together. A compact answered state may provide **Change answer**.
- Use the existing canonical answer values and service calls. â€œMaybeâ€ maps to the existing tentative answer; â€œArriving lateâ€ stays the existing late answer and must remain legible after save/reload. Do not introduce UI copy that changes API or Discord meanings.
- A published assignment whose time, character, or role changes must make the changed commitment and required response conspicuous. Preserve existing assignment-key and confirmation invalidation semantics. A republish that leaves that member's assignment unchanged must not needlessly reset their confirmation.
- Keep direct signup writes on the canonical service path (`saveRaidAnswer` / `undoRaidAnswer` and the existing online RPC). Preserve request idempotency, retry semantics, refresh/scoping, Undo, and visible save/error states. Never claim a response saved before the canonical write succeeds.
- Make an unassigned member's **Available as backup** action optional. Ask about character/reachability after they choose it. Keep live offers and deadlines prominent even if the raid is outside the default horizon. Preserve accept/decline/expiry and accepted-place confirmation behavior.
- An answered raid is not a schedule answer for other raids. A firm range overlap may be useful to planning, but it is inferred availability, not an explicit signup. Do not label every inferred overlap as a member-confirmed response.

### Schedule: one editor, two explicit scopes

- The member can identify the active scope before editing: **This week** or **Usual schedule**. Reuse an editor model where it helps, but avoid making usual edits accidentally write the current week or vice versa.
- Both scopes expose **Paint grid / Enter times** visibly. Remember the member's choice within the existing preference scope (guild and member); do not leak it across guilds or members. Migrate legacy preference keys safely if navigation sections change.
- Start with **Available times**. Put Preferred and Tentative under a clearly named expansion such as **More time options**; show an indicator when existing data uses them. Preserve these values when switching editor mode and when saving the firm schedule.
- Show whether edits affect **This week only** or **From next week onward**. Weekly edits retain their existing autosave behavior and visible saving/error state. A recurring-schedule edit remains a draft until the member explicitly saves it; do not autosave a recurring template during drag.
- Offer an intentional **Repeat weekly** action to create/update usual availability and **Reset this week to my usual times** when a weekly exception exists. Explain before replacing an exception. Keep current deadline rules and guild-time-zone wall-clock semantics, including daylight-saving transitions.
- Consolidate break and away entry as **Away dates**, with date range and **Until I return** choices. Preserve date-level absence versus paused/indefinite recurring schedule versus explicit whole-week absence. A single away day must not pause a whole week or erase underlying availability. Do not compress indefinite pause into an invented end date.
- Put review frequency, recurrence end date, and less-used lifecycle controls in **More options**, while keeping their effects and current values inspectable. Preserve pause/resume, end week, confirmation/review, and prior-template behavior.
- Preferred/tentative weekly ranges do not currently persist in usual templates. Keep them weekly-only and explain this in context. Do not silently flatten them into firm ranges.
- Remove the ordinary schedule screen's always-visible per-raid participation and per-character offer matrix. Preserve intentional character choices for unscheduled raid types in a discoverable place (Profile raid preferences or a contextual route from Schedule); do not orphan members who need to configure a raid type that has no announced card.

### Profile: occasional member decisions

- Keep character editing and the default character here. On raid cards show the chosen/default character and spec compactly with **Change**; keep a deliberate per-raid alternate choice where roster eligibility requires it.
- Show role suggested by spec and retain an explicit override for ambiguous specs (including Feral). Keep realm editable and make the member's existing realm easy to reuse for alts. Do not delete retired characters referenced by historical rosters.
- Group history and fairness explanation, reminder preference/quiet hours, private calendar subscription, account/guild switching, help, and tutorial replay into clear sections. Retain any actions that are time-sensitive in the surface where they become due; moving a general settings panel must not hide active work.
- Quiet-hours time zone remains the viewer's zone. A reminder preference controls reminders only; it does not remove messages from a guild channel. Preserve private-link creation, copy, and revocation behavior, including the one-time token display and the ability to revoke when a token was exposed.
- Keep invite auto-join/profile identity behavior and account/guild switching discoverable. Do not make Profile required for a member who already has a valid identity and wants only to answer a raid.

### Onboarding and language

- Adapt the existing tutorial. Essential onboarding ends when the member has a real character and has saved their first real answer (where a real announced raid exists). Practice remains optional and isolated from real signups/availability. Explain roster confirmation when the first actual published assignment needs it.
- Keep tutorial progress replayable and scoped. Honor existing complete/paused progress; do not restart established users or require repeating after a skipped week. Update the existing onboarding checklist and its links to the new destinations.
- Prefer plain member language: **Raid**, **Schedule**, **Maybe**, **Your spot**, **Confirm my spot**, **Available as backup**, **Away dates**. Keep distinct language when consequences differ, particularly available times vs raid signup vs roster confirmation.

## Data, service, and access invariants

- The application model and current remote RPC/services remain the sources of truth. Avoid UI-only shadow state for saved signup, confirmation, or usual schedule.
- Keep immutable model update conventions and remote recovery-draft protections. Do not overwrite a pending recovery draft as part of navigation or preference migration.
- Check guild/member scope on asynchronous feed loads and writes; stale results from a prior guild/member/week must not render as current. Bound and deduplicate feed reads.
- Maintain authorization on the server and client. A browser-only seed can make every view behave as an officer; it does not prove member access control. Exercise an authenticated non-officer fixture or hosted member test for permission claims.
- Preserve remote table/schema contracts unless a data change is necessary to represent provenance. For a migration, document forward/backward compatibility, local/offline shape, Discord and RPC impact, validation, rollback strategy, and tests before calling it complete.
- Keep published snapshots separate from officer drafts and member calendar feeds. The personal subscribed calendar reflects published assigned places according to existing rules; the member Calendar view can browse announced raids. Do not merge these data scopes.
- Keep the tutorial's practice data separate from live member state. Keep accepted standby offer behavior and existing assignment response preservation.

## Work packages and sequence

Implement in this order because later UI depends on trustworthy member state. All packages are in scope; sequence is not a phase gate for dropping work.

| ID       | Work package                                                                                | Main areas to inspect                                                                                                                                                   | Completion evidence                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MS-1** | Done                                                                                        | Status semantics and compact saved answers are implemented and covered.                                                                                                 | `raid-status.js`, `RaidQuickAnswer.svelte`, Home                                                                                                                                             | Decline, tentative, and empty legacy answers remain scoped and distinguishable. |
| **MS-2** | Done - bounded shared agenda with per-raid signup, confirmation, and standby actions        | `Home.svelte`, `RaidAgenda.svelte`, `ActionInbox.svelte`, `route.js`                                                                                                    | Announced dates are bounded and sorted, drafts are hidden, calendar clicks focus the same action row, and active offers remain visible beyond the default horizon.                           |
| **MS-3** | In progress - both scopes support Paint / Enter times; explicit reset-to-usual action added | `Availability.svelte`, `AvailabilityGrid.svelte`, `UsualScheduleEditor.svelte`, preferences                                                                             | Both schedule scopes preserve data across editor modes; reset explains its scope and preserves per-raid choices. Away/pause unification remains.                                             |
| **MS-4** | Move character and occasional tasks into Profile                                            | `Characters.svelte`, `CharacterFields.svelte`, `ReminderPreferences.svelte`, `CalendarSubscription.svelte`, `RaidRecord.svelte`, `Sidebar.svelte`, route/nav components | The new destination is discoverable; raid character change and unscheduled raid-type configuration remain possible; account, reminders, history, private calendar, and tutorial replay work. |
| **MS-5** | Simplify answer, confirmation, standby, onboarding copy and actions                         | `RaidQuickAnswer.svelte`, `StandbyOffer.svelte`, tutorial/checklist components and docs                                                                                 | Fewer default controls with canonical semantics preserved; tutorial has no required fake task and never writes practice into live state.                                                     |
| **MS-6** | Coherence, accessibility, regression, and handoff review                                    | Existing unit/component/e2e/integration/DB tests; screenshots or browser captures if available                                                                          | Complete check suite appropriate to touched layers; desktop/mobile and keyboard review; officer regression; completed ledger and review packet.                                              |

The source paths are starting points, not a mandate to force a specific component architecture. Inspect current code and tests before editing; earlier onboarding work is already present. Keep edits cohesive, avoid duplicate state/controls, and do not revert concurrent work from the user or another contributor. If Claude and Codex edit at the same time, agree file ownership first or use separate worktrees/branches and integrate deliberately.

## Acceptance criteria

### Correctness and data preservation

- [ ] Declining one raid does not mark another raid answered, the member absent all week, or the week complete.
- [ ] A tentative-only response remains Maybe/tentative, not Can't make it or absence.
- [ ] Legacy empty availability is described neutrally unless an explicit away/absence marker exists. No inference or destructive backfill.
- [ ] Firm availability, tentative availability, preferred availability, explicit raid answer, published assignment, and roster confirmation remain distinguishable in code and copy.
- [ ] A time/character/role change to a published assignment requests the appropriate fresh response; unchanged republish preserves valid confirmation.
- [ ] Save, failure, retry, Undo, and refresh never show a false successful answer. Repeating a request remains idempotent.
- [ ] Existing offline/browser mode and authenticated remote mode retain their intended behavior. Recovery drafts survive.
- [ ] Usual schedule remains firm-ranges-only unless its storage contract is fully extended. Existing preferred/tentative weekly data is never silently lost or relabeled.
- [ ] One-day absence, multi-day away, indefinite recurring pause, and recurrence end remain distinct. Underlying schedule is preserved when absence is removed according to current rules.
- [ ] Character role override, realm, retired history, per-raid alt offers, and unscheduled raid-type configuration remain available.
- [ ] Standby offer acceptance/decline/expiry and confirmation semantics remain correct; active offers are not hidden by the feed horizon.
- [ ] Private calendar link copy/revoke behavior and published-only feed boundary remain intact.
- [ ] Existing tutorial completion/paused state is honored; optional practice cannot modify real signup or schedule state.

### Experience and access

- [ ] A member can answer an announced raid from Raids without first visiting Schedule or Profile.
- [ ] The feed includes announced future dates, orders them in guild-local time, distinguishes announced raids from published places, and never reveals officer drafts.
- [ ] List and Calendar show the same member-visible scope and status; neither duplicates a separate navigation-only inbox.
- [ ] A member can use Paint grid and Enter times for both weekly and usual schedule, switch modes without data loss, and understand when a recurring edit is saved.
- [ ] Current-week versus future-week scope, deadline behavior, exception replacement, timezone, and daylight-saving behavior are understandable and correct.
- [ ] Default character is compact on a raid card; the member can deliberately change character/spec without an always-visible alt matrix.
- [ ] Profile makes its occasional tasks discoverable and time-sensitive actions remain visible where due.
- [ ] Keyboard focus, labels, selected state, touch targets, and reduced-motion expectations meet existing project patterns. Verify desktop 1440x1000, mobile 390x844, and 320px stress width.
- [ ] A non-officer cannot access officer actions or drafts. Browser-only sample behavior is not used as evidence for this criterion.
- [ ] Existing member invite/join, Discord signup, published roster, and legacy route links still work.
- [ ] No new dependency, console error, broken navigation, or unintended officer dashboard/settings regression.

## Validation and review evidence

Inspect `package.json` and repository instructions before running commands. The current documented project checks include `npm run check` (lint, format check, unit tests, build), `npm run test:e2e` (Playwright), and database/integration commands (`npm run db:start`, `npm run test:db`, `npm run test:integration`, `npm run db:stop`) when applicable. Do not report a check as passing unless it actually ran to completion; distinguish hosted/authenticated evidence from mocks.

At minimum, add/update focused tests around status scoping, announced future dates, assignment confirmation preservation/invalidation, schedule scope/mode and data retention, away versus pause, tutorial practice isolation, legacy routes, and member permissions. Run the full repository check and end-to-end suite before handoff. Run DB/integration tests if RPC, schema, sync, signup, or server authorization changed. If a required suite cannot run, state why, the exact command/result, and the residual risk; do not substitute a build-only check.

Relevant existing tests to extend include `raid-status`, `raid-answers`, `personal-raids`, `action-inbox`, `raid-services`, `view-preferences`, `availability-template`, `availability-ranges`, `closed-weeks`, `remote/rows`, and `remote/sync`; components include Home, Availability, Characters, App, Sidebar, RaidQuickAnswer, RaidResponse, UsualSchedule, AvailabilityGrid, StandbyOffers, ReminderPreferences, and RaiderTutorial. Relevant browser tests include `member-experience`, `raider-tutorial`, and `onboarding-foundation`. Search current test filenames before assuming these names are unchanged. There are signup/API/delivery integration tests and SQL tests for member experience, signups, raid responses, usual-schedule pause, standby, reminders, and access.

For browser review, capture at least one established member with unanswered and answered raids, one schedule with existing advanced data, one mobile layout, and a non-officer access path. Use realistic fixture accounts or mocks clearly labeled as mocks. Do not send Discord messages or modify a live guild as test data without explicit authorization.

## Progress ledger

Update this table during implementation so Codex can review actual completion, not inferred progress. `Not started` is the initial state; use `In progress`, `Needs review`, or `Done` and link changed files/tests where useful.

| ID   | Status      | Implementer notes / evidence                                                                                                                                                                                                                                                                     |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MS-1 | Done        | Corrected week-level labels and copy; saved raid answers now stay compact behind Change answer. See checkpoint below.                                                                                                                                                                            |
| MS-2 | Done        | Shared agenda puts signup, published-place confirmation, and standby actions on raid rows. Calendar clicks reveal and focus the matching List row. The full desktop/mobile browser suite passes.                                                                                                 |
| MS-3 | In progress | Both scopes support Paint grid / Enter times; the weekly reset-to-usual action confirms before replacing times and preserves raid/character choices. Away-date and recurring-pause scope, resume behavior, roster effect, and end-of-schedule behavior are now clearer. Lifecycle audit remains. |
| MS-4 | Done        | Profile groups characters, raid history, reminders, and the private calendar. Legacy `#/characters` resolves to Profile. Focus, mobile-width, route, and full browser coverage pass.                                                                                                             |
| MS-5 | In progress | The hands-on tutorial still records real availability separately, but its final example confirmation is optional. Raid signup presents three primary answers; arriving late is an optional modifier, still saved as canonical Late. Remaining onboarding copy/default-choice review remains.     |
| MS-6 | In progress | Full unit/build and desktop/mobile browser suites pass, including keyboard, 320px stress-width, officer dashboard/settings, and member route coverage. SQL access policies/tests were reviewed; live authenticated-guild authorization and standalone screen-reader review remain.               |

### Current work session checkpoint â€” 2026-11-25

**Completed:** MS-1's highest-risk status correction and the first compact-card behavior. `weekStatus` no longer turns a check-in with zero firm ranges into â€œAway this week.â€ It reports tentative times when present, a neutral no-times state for empty legacy answers, and away only for a paused schedule or a full seven-day absence marker. Home copy follows that distinction. `RaidQuickAnswer` continues to show the canonical saved answer, hides the answer buttons and character/spec controls after an answer, and reveals them through **Change answer**. The canonical RPC, retry/idempotency, refresh, and Undo paths remain intact.

**Verification:** Latest `npm run check` passes: lint, Prettier, 99 unit/component test files (839 tests), and production build. Full `npm run test:e2e -- --workers=2` passed at the previous checkpoint: 87 passed, 3 expected skips across desktop/mobile. After the changes below, focused Availability, UsualSchedule, and RaidQuickAnswer suites pass 24/24; the Playwright member-experience suite passes 4/4 across desktop/mobile. Production build continues to report its existing >500 kB chunk advisory. SQL access policies and existing database access tests were reviewed; database/integration tests were not rerun because no RPC or schema changed. Standalone screen-reader and live authenticated-guild review were not performed.

**Current MS-2 work:** `announcedRaidHorizon` returns date-sorted published snapshots and recurring announced times across a bounded week count; Home defaults to four weeks and lets members load four more at a time. `RaidAgenda` provides List / Calendar over the same announced member-visible events, explicit saved response or clearly labeled inferred availability, published assignments, and actions into existing services. List rows include signup/change-answer controls, published assignment confirmation, and standby actions for published unassigned raids. The featured current/next card keeps confirmation only once a raid is underway; in-horizon published raids are filtered out of the secondary upcoming list. Calendar clicks switch to List and focus the same raid row, keeping actions in one place. Unpublished drafts remain excluded. Active offers continue to surface in `ActionInbox` outside the default horizon. Full desktop/mobile browser coverage passes.

**MS-3 work in progress:** the weekly editor shows **Paint grid / Enter times** without opening advanced options. Preferred and Tentative stay under **More time options**. The usual-schedule modal exposes both editors, shares the guild/member preference, keeps drafts while switching, and saves only when the member chooses Save. When a member has a weekly exception and an active usual schedule, **Reset this week to usual times** opens a confirmation that states the week and overwritten time types; it preserves raid participation and character choices and offers Undo. Unit tests cover both scopes, preference persistence, reset confirmation, and data preservation. Away dates explain that they skip only the chosen dates and leave other weeks unchanged. Recurring schedules explain that they repeat weekly, pauses skip whole weeks until resumed, and pausing does not remove a published roster place. Ending a usual schedule now states that later weeks are left unanswered rather than marked away. The controls remain separate because their weekly versus recurring effects differ.

**Current MS-4 work:** Home now points members to Profile for characters, raid history, reminders, and the private published-roster calendar. The Profile view reuses the existing character editor and history/reminder/calendar components. The sidebar presents Raids, Schedule, and Profile as the three member destinations. Old `#/characters` routes resolve to Profile; internal first-character setup still uses the existing character editor view. Focused tests and the full desktop/mobile browser suite pass, including legacy navigation and 320px layout. Standalone assistive-technology review remains.

**Current MS-5 work:** the final tutorial example confirmation remains available but is no longer required to complete onboarding. Finishing without practice returns to Raids and leaves live raid data unchanged. Tests cover both practicing and skipping. Raid signup now presents **I’m in / Tentative / Can’t make it** as the three primary actions. **Arriving late** is an optional setting under **More signup options**; choosing **I’m in** with that setting still stores status `late`, displays “Signed up · arriving late,” and can be changed back to on-time. Unit and desktop/mobile browser tests cover save, reload, and status display. Finish reviewing optional character/spec choices and tutorial/default copy against the signup and Discord flows.

**Next:** finish the MS-3 lifecycle wording audit and MS-5 tutorial/default-copy review. For MS-6, perform a standalone screen-reader pass and live authenticated-guild authorization review when a safe authenticated test guild is available; existing SQL access policies and database tests were inspected but not executed in this checkpoint. Keep existing schema and RPC behavior unchanged unless a cross-layer migration is fully justified.

**Claude resume note:** Do not redo MS-1, the bounded List / Calendar agenda, the usual-schedule Paint editor, the three member navigation labels, Profile grouping, the reset-to-usual confirmation, or the optional tutorial practice. Latest `npm run check` passes (839 tests/build); the full desktop/mobile browser suite passed 87 tests with 3 expected skips before this checkpoint, and the latest member-experience suite passes 4/4 across desktop/mobile. Focused schedule/signup unit suites pass 24/24. MS-2 and MS-4 are done. MS-3 needs its final lifecycle wording audit; MS-5 needs remaining tutorial/default-copy review; MS-6 needs standalone screen-reader and live authenticated-guild permission review. Codex has not sent an external message to Claude. To resume in Claude, provide this document and say: “Continue from the 2026-11-25 checkpoint. MS-1, MS-2, and MS-4 are complete. The schedule scope, recurring pause, weekly away dates, and end-of-schedule behavior are clearer. Signup has three primary answers with late arrival as a modifier that preserves canonical Late state. Continue the MS-3/MS-5 review and perform the remaining MS-6 accessibility and permission checks. Run relevant checks after changes and keep the ledger accurate.”

### Final handoff packet

Claude should report:

1. Branch and exact base/head commits; list of completed work packages and any deviations from this contract with rationale.
2. User-visible behavior changes and the files/routes involved.
3. Tests/checks run, exact commands, outcomes, and any skips/failures. Mark mocked, local DB, and authenticated/hosted evidence separately.
4. Any data/schema/RPC migration, Discord compatibility, recovery, or rollout implications.
5. Screenshots/browser captures and viewport/role used, if browser review was performed.
6. Remaining acceptance criteria, known limitations, and follow-up decisions. Do not mark MS-6 done while required work or material failures remain.

## Collaboration prompts

### Prompt for Claude: implementer

> Read `docs/MEMBER_SIMPLIFICATION_HANDOFF.md`, `docs/MEMBER_SIMPLIFICATION.md`, relevant repository instructions, and the existing onboarding implementation before editing. You are implementation lead for the complete in-scope member simplification. Treat the handoff's fixed constraints and acceptance criteria as the contract; preserve Paint grid for weekly and usual schedules, the member/officer permission boundary, Discord semantics, schedule data, and published roster confirmation. Implement the work packages in order, updating the progress ledger and tests as you go. Inspect actual persistence and RPC behavior before changing data. Do not silently infer legacy absence, flatten preferred/tentative times, or add schema fields without tracing all readers/writers and migration consequences. Run the full checks required by the changed layers and provide the final handoff packet from this document with exact evidence. Do not claim work is merged, deployed, or hosted-verified unless that happened.

### Prompt for Codex: product and code reviewer

> Review Claude's branch against `docs/MEMBER_SIMPLIFICATION_HANDOFF.md` and the current code, not just the screenshots. First verify status semantics and data preservation: per-raid decline/tentative versus week absence; explicit versus inferred availability; firm versus preferred/tentative; Paint in both schedule scopes; away dates versus recurrence pause; assignment change/confirmation preservation; active standby offers; route/Discord compatibility; recovery and member authorization. Check the changed tests and run relevant checks if available. Review desktop, mobile, and keyboard evidence, and ensure officer dashboard/settings did not regress. Return concrete findings ranked by severity with file/line and scenario, followed by acceptance gaps and residual risk. Do not waive a criterion because the visual redesign looks polished. If a correction is necessary, implement it or clearly identify the blocker and the smallest safe resolution.

## Non-goals and deferred decisions

- Redesigning officer dashboard/settings or changing officer permission policy.
- Removing the Paint grid or replacing it with range-only entry.
- Changing Discord into an app-only flow.
- Automatically confirming spots from usual schedules, tentative answers, or broad availability matches.
- Rebuilding the entire application architecture or adding a framework/dependency without a demonstrated need.
- Reinterpreting ambiguous legacy availability as explicit absence.
- Claiming usability improvements from measured user outcomes without a user study.

**Implementation readiness:** Ready. No product clarification blocks the first implementation pass. The legacy absence and recurring tentative/preferred data limits have safe behavior specified above. Any proposed storage expansion must be justified and documented as implementation proceeds.
