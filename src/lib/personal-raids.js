import { SLOT_MINUTES } from './constants.js'
import {
  pausedIn,
  templateAnswers,
  templateConfirmedOn,
  templateFor,
  templateNeedsReview,
} from './availability-template.js'
import { own } from './ids.js'
import { charactersOf } from './model.js'
import { formatMonthDay } from './time.js'

/** Only a published snapshot is a promise to players; draft edits never change this list. */
export function personalRaids(state, memberId, now = Date.now()) {
  if (!memberId) return []
  return Object.entries(state.weeks)
    .flatMap(([weekIso, week]) =>
      state.settings.raids.flatMap((raid) => {
        const draft = own(week.plans, raid.id)
        const plan = draft?.published
        if (!plan || draft.cancelled) return []
        const end = plan.end ?? plan.start + raid.durationSlots * SLOT_MINUTES * 60_000
        if (end <= now) return []
        const assignment = plan.team.find((entry) => entry.memberId === memberId)
        return [
          {
            weekIso,
            raidId: raid.id,
            raid,
            plan,
            assignment: assignment ?? null,
            character: assignment
              ? (state.characters.find((c) => c.id === assignment.characterId) ?? null)
              : null,
            session: { start: plan.start, end },
          },
        ]
      }),
    )
    .sort((a, b) => a.session.start - b.session.start || a.raid.name.localeCompare(b.raid.name))
}

export function availabilitySource(state, weekIso, memberId) {
  if (own(state.weeks[weekIso]?.checkins, memberId)?.checkedIn) return 'Updated this week'
  const template = own(state.templates, memberId)
  if (templateFor(template, weekIso)) return 'Using usual schedule'
  if (pausedIn(template, weekIso)) return 'Usual schedule paused'
  return 'No response yet'
}

/**
 * How fresh an inherited answer is, for officers: when the member last confirmed the usual schedule
 * filling in this week, and whether that review is overdue. Null when the week is not inherited.
 */
export function scheduleFreshness(state, weekIso, memberId, today) {
  if (own(state.weeks[weekIso]?.checkins, memberId)) return null
  const template = own(state.templates, memberId)
  if (!templateFor(template, weekIso)) return null
  const confirmed = `confirmed ${formatMonthDay(templateConfirmedOn(template))}`
  return templateNeedsReview(template, today) ? `${confirmed} · review due` : confirmed
}

/**
 * Setup is done once: any week's answer (unavailable counts) or a usual schedule completes it.
 * A missing answer for this week is a weekly nudge on Home, not a reason to restart setup.
 */
export function hasGivenAvailability(state, weekIso, memberId) {
  if (templateAnswers(own(state.templates, memberId), weekIso)) return true
  return Object.values(state.weeks).some((week) => own(week.checkins, memberId)?.checkedIn)
}

/** Setup readiness is personal. */
export function onboardingSteps(state, memberId, weekIso = state.currentWeek) {
  return [
    {
      id: 'joined',
      label: 'Join your guild',
      complete: state.members.some((m) => m.id === memberId),
      view: null,
    },
    {
      id: 'character',
      label: 'Add a character',
      complete: charactersOf(state, memberId).length > 0,
      view: 'characters',
    },
    {
      id: 'availability',
      label: 'Set your availability',
      complete: hasGivenAvailability(state, weekIso, memberId),
      view: 'availability',
    },
  ]
}

/**
 * "Fri, Oct 23 · 7:00 – 10:00 PM PDT" for a session that starts and ends on the same local day;
 * the exact label when it crosses midnight, where the second date matters.
 */
export function compactSessionLabel({ start, end }, zone) {
  const day = (instant) => new Date(instant).toLocaleDateString('en-CA', { timeZone: zone })
  if (day(start) !== day(end)) return exactSessionLabel({ start, end }, zone)
  const date = new Date(start).toLocaleDateString('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const times = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).formatRange(start, end)
  return `${date} · ${times}`
}

/** Full dates on both ends remove ambiguity across midnight, timezones and DST transitions. */
export function exactSessionLabel({ start, end }, zone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}
