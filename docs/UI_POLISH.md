# Raid workspace polish

## Design contract

The four daily-use screens are My raids, My availability, Officer dashboard, and Raid planner. Keep the charcoal, ivory, and antique-gold guild identity, with green for availability, blue for published rosters, and amber for work that needs attention. Use the existing typefaces and icon component. No new packages or external imagery are needed for these operational screens.

Local observations: the officer dashboard is an undifferentiated list; availability puts schedule settings before the editor; the player page has no prominent availability shortcut; planner metrics and suggestions need stronger visual hierarchy. Preserve all scheduling, publication, permissions, timezone, response, recovery, and Undo behavior.

- My raids: place a direct check-in action beside the page title, make the next assignment the visual anchor, and distinguish the availability summary and calendar. Empty assignments must still lead to availability.
- My availability: expose a simple numbered workflow, make time-entry mode and availability types clearly selectable, show saved status, and place repeating schedules and away dates after the editor. Character participation remains directly reachable on phones. Default to the readable time-range editor for new preferences.
- Officer dashboard: show actionable workload totals and a needs-attention filter, group raids by week, separate publication status from issues, and preserve issue-specific links into the planner and return focus.
- Raid planner: give schedule, roster, and responses distinct task navigation, emphasize ranked session choices and selected state, and show check-in/roster progress without pushing the primary task below the first viewport.
- Shared frame: a stronger guild identity, clear active navigation, refined surface contrast and consistent controls. Avoid decorative imagery or extra landing sections that delay the task.
- Viewports: 1440x1000 and 390x844; 320x780 stress check with long names. Maintain keyboard navigation, visible focus, text status cues, 44px phone controls, and reduced motion.

Content checks: loading and error/retry for responses; empty raids/check-ins; partial rosters and missing replies; successful edits and publication; player read-only and closed availability. Authenticated services may be verified through isolated mocked transport; record live-service limits explicitly.
