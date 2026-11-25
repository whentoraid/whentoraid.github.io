# Member experience simplification review

## Recommendation

Organize the member experience around three destinations: **Raids**, **Schedule**, and **Profile**. A member with announced raid times should be able to open the app, answer the relevant raid, and leave. A guild still choosing times should direct members to Schedule instead.

Keep the paint grid as a visible editor choice for both weekly and repeating schedules. Simplify what members must decide before they can use it.

This is a review of the current implementation, with small model reproductions for the status issues below. It does not include observed user timings or usability-study results. No application behavior has been changed for this review.

## Fix misleading statuses first

With a fresh member check-in in a guild with three raids, declining only one raid makes `weekStatus` return **Absent this week**. The same function returns that status for a check-in containing tentative times but no firm times. Home also describes an empty firm-time list as being unable to make the whole week.

These statements cover more than the member actually answered. Replace them with scoped information:

- A raid card says **Not going**, **Maybe**, **Available**, **Waiting for roster**, or the actual published-place status for that raid.
- A schedule summary says whether times were entered, inherited, paused, or explicitly marked away. Tentative times are identified separately.
- An unanswered raid remains unanswered; one raid response must not imply that every raid was answered.
- Only an explicit whole-week absence should be described as unavailable all week.

Evidence: `src/lib/raid-status.js`, `src/lib/model.js:setRaidParticipation`, and `src/views/Home.svelte`. The two examples were reproduced using the existing seed state and pure model functions.

## Proposed destinations

| Destination | Always available                                                             | Show only when needed                                                         |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Raids       | Upcoming raid list, local times, personal status, appropriate answer buttons | Roster details, briefing, character/spec change, standby offer, calendar view |
| Schedule    | Current editing scope, Paint grid / Enter times, saved state                 | Preferred/tentative times, repeat settings, away dates                        |
| Profile     | Main character, alts, account and guild access                               | Reminders and quiet hours, calendar subscription, history, tutorial, help     |

Keep the existing officer tools and permissions separate. All member paths remain keyboard accessible, and the alternative time-entry editor remains available alongside paint.

## Changes by area

### 1. One list for upcoming raids

Home currently combines a next-assignment panel, signup panel, action inbox, page-jump navigation, weekly check-in panel, upcoming published raids, month calendar, history, and preferences. It also repeats availability actions in several places.

Use one chronological list covering the next few weeks, with unanswered or changed raids emphasized. The same raid card progresses from awaiting an answer to awaiting roster selection to a published place. Once answered or confirmed, reduce it to a compact summary with **Change answer**.

Offer **List / Calendar** as two views of the same information. Members currently see signup cards for this week, while the month calendar shows published rosters only. Include explicitly announced future dates in the member list and distinguish scheduled raids from assigned places; never expose officer draft times.

Avoid a separate inbox that merely links to controls already present in the list. A replacement offer or schedule review can appear directly where the action happens. Retain time-sensitive offers even when their raid is outside the initial visible range.

Source: `src/views/Home.svelte`, `src/components/ActionInbox.svelte`, `src/components/RaidMonth.svelte`.

### 2. One schedule editor, including paint

Make the editing scope unmistakable: **This week** or **Usual schedule**. Use the same editor for both, with visible **Paint grid / Enter times** controls and a remembered preference. The current usual-schedule modal supports time ranges only; the weekly paint control is nested under Editing options.

Start with Available times. Put Preferred and Tentative under **More time options**, with an indicator whenever existing data uses them. Do not erase those times when changing editor mode.

Consolidate the overlapping repeat controls: Set my usual schedule, Repeat these times each week, Save as usual schedule, and Use usual schedule this week. Use **Repeat weekly** for creating a repeating schedule and **Reset this week to my usual times** only when an exception exists. Show a concise explanation before replacing that exception.

Combine the visible entry points for taking a break and marking away into **Away dates**, supporting a date range or Until I return. Recurrence end dates and review frequency can live under More options. Preserve the distinction between a partial-day/week absence and an indefinite break underneath.

Make the effect of an edit explicit before saving: **This week only** or **From next week onward**, especially after a deadline. Avoid adding a second Submit/Check-in step to edits that already save automatically.

Source: `src/views/Availability.svelte`, `src/components/UsualSchedule.svelte`, `src/components/UsualScheduleEditor.svelte`.

### 3. Stop asking about characters during schedule entry

Keep character management in Profile. On raid cards, show the default character and spec as a short summary with **Change**. Let members expose alternate characters for a raid from that control.

Remove the always-visible Raid & characters area from ordinary schedule entry. Its Participate checkbox and per-character Offer checkboxes compete with the direct raid answers. Preserve those capabilities as an intentional per-raid choice rather than silently changing which alts officers may use.

In character setup, show the role suggested by specialization. Offer a role override as needed; ambiguous specs such as Feral still require a real role choice. Keep realm editable and suggest the member's existing realm for alts.

Source: `src/views/Availability.svelte`, `src/views/Characters.svelte`, `src/components/CharacterFields.svelte`, `src/components/RaidQuickAnswer.svelte`.

### 4. Fewer answer controls, with clear consequences

Use **I'm in / Maybe / Can't make it** for signup. Present **Arriving late** as an additional choice within a positive answer, and keep the saved Late status visible. This should continue writing the existing canonical late answer; changing the UI must not lose it.

After publication, show **Confirm my spot** when a response is needed. After confirmation, use **Confirmed · Change answer**, rather than leaving every alternative action equally prominent.

Keep roster confirmation for the first redesign. Availability and a published commitment have different meanings, and officers may change the time, character, or role. A later reduction in repeat confirmations could carry forward an explicit firm signup only when the final assignment matches it exactly. A usual schedule or tentative response must never silently count as a confirmation.

For an unassigned member, show **Available as backup** as an optional action. Ask about character and reachability after they choose it, while keeping actual offers and their deadlines prominent. Do not automatically put declined members on standby.

Source: `src/components/RaidQuickAnswer.svelte`, `src/components/RaidResponse.svelte`, `src/components/StandbyOffer.svelte`.

### 5. Move occasional decisions into Profile

History, fairness explanations, reminder preferences, calendar subscriptions, and account controls need to remain discoverable without taking space in the daily raid flow. Group them under Profile with clear sections.

Use a reminder toggle with quiet hours revealed when relevant. Keep account/guild switching easy to find. Put calendar-link creation and revocation inside calendar settings and keep their consequences clear. History should open with the member's actual raids; detailed fairness explanations can be an expansion.

Source: `src/views/Home.svelte`, `src/components/ReminderPreferences.svelte`, `src/components/CalendarSubscription.svelte`, `src/components/RaidRecord.svelte`.

### 6. Shorten the tutorial and vocabulary

The new tutorial helps, but its required practice confirmation adds a task before a member has a real roster spot. End essential onboarding after a real character and first answer are saved. Make practice optional, and explain confirmation on the first real published assignment.

Keep tutorial replay available in Profile. Do not require members to repeat onboarding after a skipped week.

Use Schedule, Maybe, Your spot, and Available as backup where appropriate. Avoid mixing check-in, participation, offering characters, availability, and signup to describe the same visible action. Preserve distinct language where the consequences differ, especially signup versus roster confirmation.

## Delivery order

1. **Correct status scope and shorten Raids.** Highest priority because these determine whether members know what still needs an answer. Include future announced dates, compact answered cards, and a clear route to Profile settings.
2. **Unify Schedule.** Keep paint prominent, support it for repeating schedules, consolidate repeat/away controls, and relocate character choices.
3. **Reduce exceptional controls.** Simplify character overrides, late answers, standby, reminders, and the tutorial. Revisit automatic confirmation only after the new flow is understood.

Avoid changing persisted schedule semantics or removing stored options merely to simplify the screen. Update app and Discord descriptions together when changing status vocabulary.

## Acceptance examples

- An established member with a default character can answer an announced raid directly from the landing page.
- Declining Friday does not mark Saturday answered or the member away for the whole week.
- A member can paint both a one-week exception and a repeating schedule without changing editor tools.
- A regular member with an unchanged schedule can see whether anything needs attention without opening settings.
- A roster time/character change remains conspicuous and requires the appropriate fresh response.
- Discord answers and app answers show the same saved state; retries, errors, and Undo remain visible.
- All retained advanced data survives the redesign, and mobile and keyboard users can reach every option.
