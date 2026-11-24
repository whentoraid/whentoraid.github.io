# Raider onboarding

The first useful outcome for a member is a saved character and an availability answer their officers can use. Confirmation comes later, when an officer publishes a roster with that member on it.

## Friction addressed

- The old checklist linked to separate screens without teaching the workflow. A three-step tutorial now uses the real character form and raid answers, then a clearly labeled practice confirmation. New guild joins open it automatically; members can pause, resume, or replay it from the menu.
- The checklist was below the weekly panels on My raids. Setup now appears first for members who still need it.
- Character and spec selectors competed with the answer buttons on every raid. Those options now sit behind “Change character or spec,” with the chosen character, spec, and role visible in the summary. The first character automatically becomes the main.
- A member could mistake weekly availability for an additional requirement after signing up. Raid cards now explain that one direct answer is enough for that raid.

## Behavior

The tutorial saves characters and availability through the existing app paths. It waits for pending saves before advancing. A decline counts as an answer. If no raid time is announced, it offers actual weekly time ranges or an unavailable answer. After the weekly deadline it uses next week, unless a direct raid answer is still open.

The confirmation example never writes a raid response. Tutorial progress is private browser storage scoped to guild and member; actual characters and answers remain guild data. Closing with Escape or Finish later preserves saved work. No database migration is needed.

## Validation

Component coverage checks save failure and retry, required actions, practice isolation, pause/resume, and guild scoping. Desktop and phone browser coverage follows real signup and weekly-availability paths, reloads progress, checks layout, and verifies that practice does not change guild data.

Future usability observation: time a new member from joining to a saved first answer, and watch whether they can explain the difference between signing up and confirming a published spot. No analytics are added by this change.
