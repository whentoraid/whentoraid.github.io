import { describe, expect, test } from 'vitest'
import { templateFor } from './availability-template.js'
import { changesClosedWeek, checkinsClosed, waitingOn } from './checkins.js'
import {
  confirmAvailabilityTemplate,
  getCheckin,
  markUnavailable,
  pauseAvailabilityTemplate,
  removeAvailabilityTemplate,
  resumeAvailabilityTemplate,
  saveAvailabilityTemplate,
  setAvailabilityTemplateEnd,
  setAvailabilityTemplateReview,
} from './model.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import { addDays } from './time.js'

const member = 'm0'
// The seed has no check-ins for the week after SEED_WEEK. Its deadline is Wednesday Oct 7, 6 pm in
// Los Angeles: Oct 8, 01:00 UTC.
const WEEK = addDays(SEED_WEEK, 7)
const BEFORE_DEADLINE = Date.UTC(2026, 9, 8, 0, 0)
const AFTER_DEADLINE = Date.UTC(2026, 9, 8, 2, 0)

describe('closed check-in weeks', () => {
  test('a week closes at its deadline, and never without one', () => {
    const state = createSeedState()
    expect(checkinsClosed(state, WEEK, BEFORE_DEADLINE)).toBe(false)
    expect(checkinsClosed(state, WEEK, AFTER_DEADLINE)).toBe(true)
    const none = { ...state, settings: { ...state.settings, checkinDeadline: null } }
    expect(checkinsClosed(none, WEEK, AFTER_DEADLINE)).toBe(false)
  })

  test('a new schedule from next week keeps the closed week on the schedule it replaced', () => {
    const before = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, AFTER_DEADLINE)
    const after = saveAvailabilityTemplate(
      markUnavailable(before, addDays(WEEK, 7), member),
      addDays(WEEK, 7),
      member,
      AFTER_DEADLINE,
    )
    expect(templateFor(after.templates[member].previous, WEEK)).toEqual(
      templateFor(before.templates[member], WEEK),
    )
    expect(getCheckin(after, WEEK, member)).toEqual(getCheckin(before, WEEK, member))
    expect(getCheckin(after, addDays(WEEK, 14), member).ranges).toEqual([])
    expect(changesClosedWeek(before, after, member, AFTER_DEADLINE)).toBe(false)
  })

  test('a second future schedule still keeps the one covering this week', () => {
    const base = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, AFTER_DEADLINE)
    const next = addDays(WEEK, 7)
    const first = saveAvailabilityTemplate(markUnavailable(base, next, member), next, member, AFTER_DEADLINE)
    const later = addDays(WEEK, 14)
    const second = saveAvailabilityTemplate(first, later, member, AFTER_DEADLINE)
    expect(getCheckin(second, WEEK, member)).toEqual(getCheckin(base, WEEK, member))
    expect(changesClosedWeek(first, second, member, AFTER_DEADLINE)).toBe(false)
  })

  test('without a schedule covering this week, the next future schedule is kept for the weeks before', () => {
    const state = createSeedState()
    const next = addDays(WEEK, 7)
    const first = saveAvailabilityTemplate(state, next, member, AFTER_DEADLINE)
    const second = saveAvailabilityTemplate(
      markUnavailable(first, addDays(WEEK, 14), member),
      addDays(WEEK, 14),
      member,
      AFTER_DEADLINE,
    )
    expect(getCheckin(second, next, member)).toEqual(getCheckin(first, next, member))
  })

  test('removing a schedule that fills the closed week changes it; before the deadline it does not count', () => {
    const before = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, AFTER_DEADLINE)
    const after = removeAvailabilityTemplate(before, member)
    expect(changesClosedWeek(before, after, member, AFTER_DEADLINE)).toBe(true)
    expect(changesClosedWeek(before, after, member, BEFORE_DEADLINE)).toBe(false)
  })

  test('a saved check-in for the closed week makes schedule changes harmless', () => {
    const saved = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, AFTER_DEADLINE)
    const before = markUnavailable(saved, WEEK, member)
    const after = removeAvailabilityTemplate(before, member)
    expect(changesClosedWeek(before, after, member, AFTER_DEADLINE)).toBe(false)
  })

  test('the schedule a template replaced covers only the weeks before it', () => {
    const current = { fromWeek: '2026-10-12', slots: [1] }
    const previous = { fromWeek: '2026-09-28', slots: [2] }
    const template = { ...current, previous }
    expect(templateFor(template, '2026-10-19')).toEqual(current)
    expect(templateFor(template, '2026-10-05')).toEqual(previous)
    expect(templateFor(template, '2026-09-21')).toBeNull()
  })
})

describe('pausing, ending and reviewing a usual schedule', () => {
  const saved = () => saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, BEFORE_DEADLINE)
  const LATER = addDays(WEEK, 14)

  test('saving confirms the schedule today in the guild', () => {
    expect(saved().templates[member].confirmedAt).toBe('2026-10-07')
  })

  test('a paused week is answered as away and nobody waits on it; resuming brings the times back', () => {
    const base = saved()
    const times = getCheckin(base, LATER, member).ranges
    const { state } = pauseAvailabilityTemplate(base, member, WEEK)
    expect(getCheckin(state, LATER, member)).toMatchObject({ checkedIn: true, ranges: [], paused: true })
    expect(waitingOn(state, LATER).some((m) => m.id === member)).toBe(false)
    const resumed = resumeAvailabilityTemplate(state, member, LATER)
    expect(getCheckin(resumed, WEEK, member).paused).toBe(true)
    expect(getCheckin(resumed, LATER, member).ranges).toEqual(times)
  })

  test('a saved check-in for a paused week still wins', () => {
    const { state } = pauseAvailabilityTemplate(saved(), member, WEEK)
    const answered = markUnavailable(state, WEEK, member)
    expect(getCheckin(answered, WEEK, member).paused).toBeUndefined()
  })

  test('pausing a week whose check-ins closed is caught, like any change to it', () => {
    const before = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, member, BEFORE_DEADLINE)
    const thisWeekPause = pauseAvailabilityTemplate(before, member, WEEK).state
    expect(changesClosedWeek(before, thisWeekPause, member, AFTER_DEADLINE)).toBe(true)
    const nextWeekPause = pauseAvailabilityTemplate(before, member, addDays(WEEK, 7)).state
    expect(changesClosedWeek(before, nextWeekPause, member, AFTER_DEADLINE)).toBe(false)
    const reviewed = confirmAvailabilityTemplate(before, member, AFTER_DEADLINE)
    expect(changesClosedWeek(before, reviewed, member, AFTER_DEADLINE)).toBe(false)
  })

  test('after its last week the member is asked again rather than marked unavailable', () => {
    const { state } = setAvailabilityTemplateEnd(saved(), member, WEEK)
    expect(getCheckin(state, WEEK, member).checkedIn).toBe(true)
    expect(getCheckin(state, LATER, member).checkedIn).toBe(false)
    expect(waitingOn(state, LATER).some((m) => m.id === member)).toBe(true)
    expect(setAvailabilityTemplateEnd(state, member, null).state.templates[member].endWeek).toBeUndefined()
    expect(setAvailabilityTemplateEnd(state, member, addDays(SEED_WEEK, -7)).error).toMatch(/from when/)
  })

  test('invalid pauses are refused, and the review interval is the member’s choice', () => {
    expect(pauseAvailabilityTemplate(createSeedState(), member, WEEK).error).toMatch(/Save a usual schedule/)
    expect(pauseAvailabilityTemplate(saved(), member, WEEK, WEEK).error).toMatch(/Resume after/)
    expect(setAvailabilityTemplateReview(saved(), member, 4).templates[member].reviewWeeks).toBe(4)
    expect(setAvailabilityTemplateReview(saved(), member, 5).templates[member].reviewWeeks).toBeUndefined()
    const resaved = saveAvailabilityTemplate(
      setAvailabilityTemplateReview(saved(), member, 12),
      WEEK,
      member,
      BEFORE_DEADLINE,
    )
    expect(resaved.templates[member].reviewWeeks).toBe(12)
  })
})
