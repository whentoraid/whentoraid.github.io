import { describe, expect, test } from 'vitest'
import {
  DEFAULT_REVIEW_WEEKS,
  pausedIn,
  templateAnswers,
  templateConfirmedOn,
  templateFor,
  templateNeedsReview,
} from './availability-template.js'

const schedule = { timezone: 'America/Los_Angeles', dayStartHour: 17, slotsPerDay: 14, slots: [3, 4] }
const current = { ...schedule, fromWeek: '2026-10-05' }

describe('pausing and ending a usual schedule', () => {
  test('paused weeks have no times but still count as answered, as away', () => {
    const paused = { ...current, pausedFrom: '2026-10-19', pausedUntil: '2026-11-02' }
    expect(templateFor(paused, '2026-10-12')).toEqual(current)
    expect(templateFor(paused, '2026-10-19')).toBeNull()
    expect(pausedIn(paused, '2026-10-26')).toBe(true)
    expect(templateAnswers(paused, '2026-10-26')).toBe(true)
    // Resuming week: times are back.
    expect(templateFor(paused, '2026-11-02')).toEqual(current)
    expect(pausedIn(paused, '2026-11-02')).toBe(false)
  })

  test('a pause with no end lasts until the member resumes', () => {
    const paused = { ...current, pausedFrom: '2026-10-19' }
    expect(templateFor(paused, '2027-06-07')).toBeNull()
    expect(templateAnswers(paused, '2027-06-07')).toBe(true)
  })

  test('after its last week a schedule fills nothing in and does not answer, so the member is asked', () => {
    const ending = { ...current, endWeek: '2026-10-26' }
    expect(templateFor(ending, '2026-10-26')).toEqual(current)
    expect(templateFor(ending, '2026-11-02')).toBeNull()
    expect(templateAnswers(ending, '2026-11-02')).toBe(false)
  })

  test('the governing schedule is chosen first; a newer schedule never falls back to the older one', () => {
    const previous = { ...schedule, fromWeek: '2026-09-07', slots: [1] }
    const template = { ...current, pausedFrom: '2026-10-05', previous }
    expect(templateFor(template, '2026-09-28')).toEqual(previous)
    expect(templateFor(template, '2026-10-12')).toBeNull()
  })

  test('review and pause details never count as a change of times', () => {
    const reviewed = { ...current, confirmedAt: '2026-10-18', reviewWeeks: 4 }
    expect(templateFor(reviewed, '2026-10-12')).toEqual(templateFor(current, '2026-10-12'))
  })
})

describe('reviewing a usual schedule', () => {
  test('it is due once the member’s interval has passed since it was last confirmed', () => {
    const template = { ...current, confirmedAt: '2026-10-01' }
    expect(templateConfirmedOn(template)).toBe('2026-10-01')
    expect(templateNeedsReview(template, '2026-11-25')).toBe(false)
    expect(templateNeedsReview(template, '2026-11-26')).toBe(true)
    expect(templateNeedsReview({ ...template, reviewWeeks: 2 }, '2026-10-15')).toBe(true)
    expect(DEFAULT_REVIEW_WEEKS).toBe(8)
  })

  test('a schedule saved before reviews existed counts from its first week', () => {
    expect(templateConfirmedOn(current)).toBe('2026-10-05')
  })

  test('nothing is asked while the schedule is paused or has ended', () => {
    const old = { ...current, confirmedAt: '2026-01-05' }
    expect(templateNeedsReview({ ...old, pausedFrom: '2026-10-12' }, '2026-10-20')).toBe(false)
    expect(templateNeedsReview({ ...old, endWeek: '2026-10-05' }, '2026-10-20')).toBe(false)
    expect(templateNeedsReview(null, '2026-10-20')).toBe(false)
  })
})
