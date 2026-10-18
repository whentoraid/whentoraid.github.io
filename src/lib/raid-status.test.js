import { describe, expect, test } from 'vitest'
import { markUnavailable, saveAvailabilityTemplate } from './model.js'
import { placeStatus, STATUS, weekStatus } from './raid-status.js'
import { createSeedState, SEED_WEEK } from './seed.js'

describe('raid status vocabulary', () => {
  test('a week answer reads as signed up or absent, and a usual schedule counts as signed up', () => {
    const fresh = { ...createSeedState(), weeks: {}, templates: {} }
    expect(weekStatus(fresh, SEED_WEEK, 'm0')).toBe(STATUS.noAnswer)
    expect(weekStatus(markUnavailable(fresh, SEED_WEEK, 'm0'), SEED_WEEK, 'm0')).toBe(STATUS.absent)
    const seeded = { ...createSeedState(), templates: {} }
    expect(weekStatus(seeded, SEED_WEEK, 'm0')).toBe(STATUS.signedUp)
    const scheduled = { ...saveAvailabilityTemplate(seeded, SEED_WEEK, 'm0', 0), weeks: {} }
    expect(weekStatus(scheduled, SEED_WEEK, 'm0')).toBe(STATUS.signedUp)
  })

  test('a selected player needs to confirm until they respond', () => {
    expect(placeStatus(null)).toBe('Selected · confirmation needed')
    expect(placeStatus({ status: 'confirmed' })).toBe('Confirmed')
    expect(placeStatus({ status: 'tentative' })).toBe('Selected · tentative')
    expect(placeStatus({ status: 'unavailable' })).toBe('Selected · can’t make it')
  })
})
