import { describe, expect, test } from 'vitest'
import { createSeedState } from './seed.js'
import {
  offerCandidates,
  offerDeadline,
  offerStatus,
  reachableStandby,
  standbyUntilOptions,
  timeLeft,
} from './standby.js'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-02T12:00:00Z')

describe('offer deadlines', () => {
  test('an offer is open for the chosen hours, but never past the raid’s start', () => {
    expect(offerDeadline(NOW, 3, NOW + 10 * HOUR)).toBe(NOW + 3 * HOUR)
    expect(offerDeadline(NOW, 24, NOW + 10 * HOUR)).toBe(NOW + 10 * HOUR)
  })

  test('an open offer past its deadline reads as expired; answered ones keep their status', () => {
    const offer = { status: 'open', expires_at: new Date(NOW).toISOString() }
    expect(offerStatus(offer, NOW - 1)).toBe('open')
    expect(offerStatus(offer, NOW)).toBe('expired')
    expect(offerStatus({ ...offer, status: 'accepted' }, NOW + HOUR)).toBe('accepted')
  })

  test('time left reads in hours and minutes', () => {
    expect(timeLeft(NOW + 2 * HOUR + 15 * 60_000, NOW)).toBe('2 h 15 min left')
    expect(timeLeft(NOW + 3 * HOUR, NOW)).toBe('3 h left')
    expect(timeLeft(NOW + 30_000, NOW)).toBe('1 min left')
    expect(timeLeft(NOW, NOW)).toBe('expired')
  })
})

describe('standby', () => {
  test('a player stops being reachable at the time they chose', () => {
    const rows = [
      { raid_id: 'raid-20', member_id: 'a', until_ms: null },
      { raid_id: 'raid-20', member_id: 'b', until_ms: NOW },
      { raid_id: 'raid-20', member_id: 'c', until_ms: String(NOW + HOUR) },
      { raid_id: 'other', member_id: 'd', until_ms: null },
    ]
    expect(reachableStandby(rows, 'raid-20', NOW).map((row) => row.member_id)).toEqual(['a', 'c'])
  })

  test('reachable-until choices that have already passed are not offered', () => {
    const start = NOW + 2 * HOUR
    expect(standbyUntilOptions(start, NOW)).toEqual([
      { label: 'Until the raid starts', value: null },
      { label: 'Until 1 hour before it starts', value: start - HOUR },
    ])
  })

  test('players on standby are offered first, with the character they chose first', () => {
    const state = createSeedState()
    const [rostered, ...others] = state.members
    const tank = (memberId) => state.characters.find((c) => c.memberId === memberId && c.role === 'Tank')
    const withTank = others.filter((member) => tank(member.id))
    const waiting = withTank.at(-1)
    const published = { team: [{ memberId: rostered.id, characterId: 'x', role: 'Tank' }] }
    const candidates = offerCandidates(state, published, 'Tank', [
      { member_id: waiting.id, character_id: tank(waiting.id).id },
    ])
    expect(candidates[0]).toMatchObject({ member: waiting, standby: true, chosen: true })
    expect(candidates.every((option) => option.character.role === 'Tank')).toBe(true)
    expect(candidates.some((option) => option.member.id === rostered.id)).toBe(false)
  })
})
