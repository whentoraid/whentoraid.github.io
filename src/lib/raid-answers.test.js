import { describe, expect, test } from 'vitest'
import { getCheckin } from './model.js'
import { announcedRaids, answerRaid, raidAnswer } from './raid-answers.js'
import { createSeedState } from './seed.js'

const WEEK = '2026-10-05'
const start = Date.parse('2026-10-10T02:00:00Z')
const end = start + 3 * 3600_000

/** A fresh week with raid-20 published and raid-10-2 only drafted by officers. */
function fixture() {
  const state = { ...createSeedState(), templates: {} }
  state.weeks = {
    [WEEK]: {
      checkins: {},
      plans: {
        'raid-20': { start, team: [], published: { start, end, team: [] } },
        'raid-10-2': { start: start + 86400_000, team: [] },
      },
    },
  }
  return state
}

describe('answering one raid', () => {
  test('only published or scheduled times are announced; officer drafts stay private', () => {
    const announced = announcedRaids(fixture(), WEEK)
    expect(announced.map((item) => item.raid.id)).toEqual(['raid-20'])
    expect(announced[0]).toMatchObject({ start, end })
  })

  test('"I’m in" marks the raid time and opts in, offering only the chosen character', () => {
    const state = fixture()
    const [raid] = announcedRaids(state, WEEK)
    const next = answerRaid(state, WEEK, 'm0', raid, 'in', 'c0b')
    expect(raidAnswer(next, WEEK, 'm0', raid)).toBe('in')
    const checkin = getCheckin(next, WEEK, 'm0')
    expect(checkin.raids['raid-20']).toMatchObject({ participating: true, declined: ['c0a'] })
    expect(checkin.raids['raid-10-2']).toBeUndefined()
  })

  test('tentative and out change only this raid', () => {
    const state = fixture()
    const [raid] = announcedRaids(state, WEEK)
    const tentative = answerRaid(state, WEEK, 'm0', raid, 'tentative')
    expect(raidAnswer(tentative, WEEK, 'm0', raid)).toBe('tentative')
    const out = answerRaid(tentative, WEEK, 'm0', raid, 'out')
    expect(raidAnswer(out, WEEK, 'm0', raid)).toBe('out')
    expect(getCheckin(out, WEEK, 'm0').raids['raid-10-2']).toBeUndefined()
  })

  test('an unanswered raid has no answer', () => {
    const state = fixture()
    expect(raidAnswer(state, WEEK, 'm0', announcedRaids(state, WEEK)[0])).toBeNull()
  })
})
