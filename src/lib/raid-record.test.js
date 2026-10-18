import { describe, expect, test } from 'vitest'
import { setAttendance, setCancelled } from './attendance.js'
import { getWeek, setPlan } from './model.js'
import { plannerContext } from './planning.js'
import { fairnessSummary, latestFlag, personalRecord } from './raid-record.js'
import { createSeedState, SEED_WEEK } from './seed.js'
import { addDays } from './time.js'

const NEXT_WEEK = addDays(SEED_WEEK, 7)
const LATER = Date.parse('2026-10-20T00:00:00Z')

/** The sample guild with its Friday raid saved for the seed week, seen from the week after. */
function planned() {
  const seed = createSeedState()
  const { plan } = plannerContext(seed)
  const state = setPlan(seed, SEED_WEEK, { start: plan.start, team: plan.team })
  const team = getWeek(state, SEED_WEEK).plan.team.map((entry) => entry.memberId)
  const benched = seed.members.map((m) => m.id).filter((id) => !team.includes(id))
  return { state, rostered: team[0], benched: benched[0] }
}
const row = (rows) => rows.find((r) => r.weekIso === SEED_WEEK && r.raidId === 'raid-20')

describe('a player’s raid record', () => {
  test('separates volunteering, selection and what was recorded', () => {
    const { state, rostered } = planned()
    const recorded = setAttendance(state, SEED_WEEK, rostered, 'late')
    expect(row(personalRecord(recorded, rostered, NEXT_WEEK, LATER))).toMatchObject({
      volunteered: true,
      selected: true,
      outcome: 'late',
      countsForFairness: false,
    })
    expect(row(personalRecord(state, rostered, NEXT_WEEK, LATER)).outcome).toBe('rostered')
  })

  test('a player free but left off counts as a sit-out, as the planner counts it', () => {
    const { state, benched } = planned()
    expect(row(personalRecord(state, benched, NEXT_WEEK, LATER))).toMatchObject({
      volunteered: true,
      selected: false,
      outcome: 'sat-out',
      countsForFairness: true,
    })
    const summary = fairnessSummary(state, benched, NEXT_WEEK).find((s) => s.raidId === 'raid-20')
    expect(summary).toMatchObject({ satOut: 1, priority: 'fairness' })
  })

  test('a sit-out this week does not count yet: fairness looks at earlier weeks', () => {
    const { state, benched } = planned()
    expect(row(personalRecord(state, benched, SEED_WEEK, LATER)).countsForFairness).toBe(false)
  })

  test('a cancelled raid is shown as not run, and nobody sat out of it', () => {
    const { state, benched } = planned()
    const cancelled = setCancelled(state, SEED_WEEK, true)
    expect(row(personalRecord(cancelled, benched, NEXT_WEEK, LATER))).toMatchObject({
      outcome: 'cancelled',
      countsForFairness: false,
    })
    expect(fairnessSummary(cancelled, benched, NEXT_WEEK).find((s) => s.raidId === 'raid-20').satOut).toBe(0)
  })

  test('raids that have not ended yet are not part of the record', () => {
    const { state, benched } = planned()
    const { start } = getWeek(state, SEED_WEEK).plan
    expect(row(personalRecord(state, benched, NEXT_WEEK, start))).toBeUndefined()
  })
})

test('a raid’s newest correction request is the one shown', () => {
  const flags = [
    { id: 'new', week: SEED_WEEK, raid_id: 'raid-20', member_id: 'm1', status: 'open' },
    { id: 'old', week: SEED_WEEK, raid_id: 'raid-20', member_id: 'm1', status: 'resolved' },
    { id: 'other', week: SEED_WEEK, raid_id: 'raid-20', member_id: 'm2', status: 'open' },
  ]
  expect(latestFlag(flags, SEED_WEEK, 'raid-20', 'm1').id).toBe('new')
  expect(latestFlag(flags, SEED_WEEK, 'raid-10', 'm1')).toBeNull()
})
