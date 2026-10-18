import { weekSlotWindows, slotWindow } from './grid.js'
import { addInterval, covers } from './intervals.js'
import { daysBetween, mondayOf } from './time.js'

/** Weeks between reviews of a usual schedule, unless the member chooses another interval. */
export const DEFAULT_REVIEW_WEEKS = 8

/** A schedule's life (pause, last week, review), not its times. Never compared as a change of times. */
const LIFECYCLE_KEYS = ['pausedFrom', 'pausedUntil', 'endWeek', 'confirmedAt', 'reviewWeeks']

/** Store wall-clock cells, not UTC offsets, so a recurring evening stays at the same local time. */
export function templateFromRanges(weekIso, ranges, guild) {
  const grid = { timezone: guild.timezone, dayStartHour: guild.dayStartHour, slotsPerDay: guild.slotsPerDay }
  const slots = weekSlotWindows(weekIso, grid).flatMap((day, d) =>
    day.flatMap((window, s) => (covers(ranges, window) ? [d * grid.slotsPerDay + s] : [])),
  )
  return { ...grid, fromWeek: weekIso, slots }
}

/**
 * The stored schedule that governs `weekIso` (the template, or the one it replaced), with its pause
 * and review details, whether or not it fills the week in.
 */
export function governing(template, weekIso) {
  if (!template) return null
  const { previous, ...current } = template
  if (weekIso >= current.fromWeek) return current
  return previous && weekIso >= previous.fromWeek ? previous : null
}

const ended = (schedule, weekIso) => Boolean(schedule.endWeek && weekIso > schedule.endWeek)
const paused = (schedule, weekIso) =>
  Boolean(
    schedule.pausedFrom &&
    weekIso >= schedule.pausedFrom &&
    !(schedule.pausedUntil && weekIso >= schedule.pausedUntil),
  )

/**
 * The times that fill in `weekIso`: the template from its `fromWeek` on, or before that the schedule
 * it replaced (`previous`), without its pause and review details. Null when no schedule governs the
 * week, it is paused, or it has ended. Mirrors template_for_week in the database.
 */
export function templateFor(template, weekIso) {
  const schedule = governing(template, weekIso)
  if (!schedule || ended(schedule, weekIso) || paused(schedule, weekIso)) return null
  return Object.fromEntries(Object.entries(schedule).filter(([key]) => !LIFECYCLE_KEYS.includes(key)))
}

/** Whether a paused usual schedule answers `weekIso` as away. */
export function pausedIn(template, weekIso) {
  const schedule = governing(template, weekIso)
  return Boolean(schedule && !ended(schedule, weekIso) && paused(schedule, weekIso))
}

/** Whether the schedule answers the week, with times or as a pause. Mirrors template_answers_week. */
export function templateAnswers(template, weekIso) {
  return templateFor(template, weekIso) !== null || pausedIn(template, weekIso)
}

/** When the member last said their usual schedule is right; older schedules count from their first week. */
export function templateConfirmedOn(template) {
  return template.confirmedAt ?? template.fromWeek
}

/** Whether to ask the member if their usual schedule still holds, as of the guild date `today`. */
export function templateNeedsReview(template, today) {
  if (!template) return false
  const week = mondayOf(today)
  if (templateFor(template, week) === null) return false
  const weeks = template.reviewWeeks ?? DEFAULT_REVIEW_WEEKS
  return daysBetween(templateConfirmedOn(template), today) >= weeks * 7
}

export function templateRanges(stored, weekIso) {
  const template = templateFor(stored, weekIso)
  if (!template) return null
  return template.slots.reduce((ranges, cell) => {
    const window = slotWindow(
      weekIso,
      Math.floor(cell / template.slotsPerDay),
      cell % template.slotsPerDay,
      1,
      template,
    )
    return window.end > window.start ? addInterval(ranges, window) : ranges
  }, [])
}
