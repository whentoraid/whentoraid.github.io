import { describe, expect, test } from 'vitest'
import { compareSuggestionRank, plannerContext, topDistinctDays } from './planning.js'
import { createSeedState } from './seed.js'
import { compareSuggestions, officerChanges } from './tradeoffs.js'

const entry = (memberId) => ({ memberId, characterId: `c-${memberId}`, role: 'DPS' })
const suggestion = (overrides) => ({
  day: 4,
  startSlot: 2,
  start: 1000,
  team: ['a', 'b', 'c'].map(entry),
  utilityCount: 1,
  firm: 3,
  thinnest: 1,
  backups: [1, 1, 2],
  fairness: 0,
  mains: 3,
  ...overrides,
})

describe('comparing two windows', () => {
  test('names the first ranking rule that tells them apart, not a later one', () => {
    const first = suggestion({ firm: 3, fairness: 0 })
    const other = suggestion({ day: 3, start: 500, firm: 2, fairness: 4 })
    const { decidedBy, rows } = compareSuggestions(first, other)
    expect(decidedBy).toBe('Firm players (not tentative)')
    expect(rows.filter((row) => row.decisive).map((row) => row.key)).toEqual(['firm'])
    expect(rows.find((row) => row.key === 'fairness')).toMatchObject({ first: 0, other: 4, decisive: false })
  })

  test('says when only the earlier start decided it', () => {
    expect(compareSuggestions(suggestion(), suggestion({ day: 5, start: 2000 })).decidedBy).toBe(
      'Earlier start',
    )
  })

  test('lists who joins and who leaves by choosing the other window', () => {
    const other = suggestion({ team: ['b', 'c', 'd'].map(entry) })
    expect(compareSuggestions(suggestion(), other)).toMatchObject({ joins: ['d'], leaves: ['a'] })
  })

  test('agrees with the planner’s ranking for the sample guild', () => {
    const [top, ...rest] = topDistinctDays(plannerContext(createSeedState()).suggestions, 3)
    for (const other of rest) {
      expect(compareSuggestionRank(top, other)).toBeLessThan(0)
      expect(compareSuggestions(top, other).decidedBy).not.toBeNull()
    }
  })
})

describe('officer changes', () => {
  test('are reported apart from the suggestion', () => {
    const saved = ['a', 'b', 'x'].map(entry)
    expect(officerChanges(saved, suggestion())).toEqual({ added: ['x'], removed: ['c'] })
  })

  test('are nothing when the saved roster matches, or nothing is saved', () => {
    expect(officerChanges(['c', 'b', 'a'].map(entry), suggestion())).toBeNull()
    expect(officerChanges(null, suggestion())).toBeNull()
  })
})
