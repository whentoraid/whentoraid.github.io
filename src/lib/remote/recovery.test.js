import { describe, expect, test } from 'vitest'
import { createSeedState, SEED_WEEK } from '../seed.js'
import { unsavedChanges, withoutChange } from './recovery.js'
import { stateToRows } from './rows.js'

const ZONE = 'America/Los_Angeles'
const BEFORE_DEADLINE = Date.parse('2026-09-28T12:00:00Z')
const AFTER_DEADLINE = Date.parse('2026-10-02T12:00:00Z')
// Friday Oct 2, guild time: 7–10 pm and 8–10 pm.
const SEVEN_TO_TEN = { start: Date.parse('2026-10-03T02:00:00Z'), end: Date.parse('2026-10-03T05:00:00Z') }
const EIGHT_TO_TEN = { start: Date.parse('2026-10-03T03:00:00Z'), end: Date.parse('2026-10-03T05:00:00Z') }

const state = createSeedState()
const base = stateToRows(state, 'g')

/** `rows` with member `memberId`'s check-in for the seed week changed by `change`. */
function withCheckin(rows, memberId, change) {
  return {
    ...rows,
    checkins: rows.checkins.map((row) =>
      row.week === SEED_WEEK && row.member_id === memberId ? { ...row, ...change } : row,
    ),
  }
}

const describeFor = (draft, server, overrides = {}) =>
  unsavedChanges(base, draft, server, {
    state,
    memberId: 'm0',
    officer: false,
    zone: ZONE,
    now: BEFORE_DEADLINE,
    ...overrides,
  })

describe('an unsaved availability edit', () => {
  test('is described by day, with the online times beside the attempted ones', () => {
    const online = withCheckin(base, 'm0', { ranges: [SEVEN_TO_TEN] })
    const draft = withCheckin(base, 'm0', { ranges: [EIGHT_TO_TEN] })
    const [change] = describeFor(draft, online)
    expect(change).toMatchObject({
      title: 'Your availability for the week of Sep 28',
      task: 'availability',
      outcome: 'conflict',
      week: SEED_WEEK,
    })
    expect(change.differences).toContainEqual({
      label: 'Fri Oct 2',
      online: '7:00 pm – 10:00 pm',
      yours: '8:00 pm – 10:00 pm',
    })
    expect(change.reason).toMatch(/replaces the online version/)
  })

  test('is ready to save again when nobody else changed it', () => {
    const draft = withCheckin(base, 'm0', { ranges: [EIGHT_TO_TEN] })
    expect(describeFor(draft, base)[0].outcome).toBe('ready')
  })

  test('counts as saved when the server already has it', () => {
    const draft = withCheckin(base, 'm0', { ranges: [EIGHT_TO_TEN] })
    expect(describeFor(draft, draft)[0].outcome).toBe('saved')
  })

  test('can no longer be applied after the week’s check-ins closed, except by an officer', () => {
    const draft = withCheckin(base, 'm0', { ranges: [EIGHT_TO_TEN] })
    const [closed] = describeFor(draft, base, { now: AFTER_DEADLINE })
    expect(closed.outcome).toBe('closed')
    expect(closed.reason).toMatch(/^Check-ins for this week closed Wed, Sep 30, 6:00 PM PDT/)
    expect(describeFor(draft, base, { now: AFTER_DEADLINE, officer: true })[0].outcome).toBe('ready')
  })
})

describe('other unsaved edits', () => {
  test('another player’s answer needs an officer', () => {
    const draft = withCheckin(base, 'm1', { ranges: [EIGHT_TO_TEN] })
    const [change] = describeFor(draft, base)
    expect(change).toMatchObject({
      title: 'Briar’s availability for the week of Sep 28',
      outcome: 'forbidden',
    })
  })

  test('a character change lists the fields that differ', () => {
    const character = base.characters.find((c) => c.member_id === 'm0')
    const draft = {
      ...base,
      characters: base.characters.map((c) => (c === character ? { ...c, spec: 'Changed spec' } : c)),
    }
    const [change] = describeFor(draft, base)
    expect(change.title).toBe(`Your character ${character.name}`)
    expect(change.differences).toEqual([{ label: 'Spec', online: character.spec, yours: 'Changed spec' }])
  })

  test('an edit to something removed online can no longer be applied', () => {
    const character = base.characters.find((c) => c.member_id === 'm0')
    const draft = {
      ...base,
      characters: base.characters.map((c) => (c === character ? { ...c, spec: 'Changed spec' } : c)),
    }
    const server = { ...base, characters: base.characters.filter((c) => c !== character) }
    expect(describeFor(draft, server)[0].outcome).toBe('gone')
  })
})

test('discarding one change keeps the others', () => {
  const draft = withCheckin(
    { ...base, members: base.members.map((m) => (m.id === 'm0' ? { ...m, name: 'Renamed' } : m)) },
    'm0',
    { ranges: [EIGHT_TO_TEN] },
  )
  const [rename, availability] = describeFor(draft, base)
  expect(rename.title).toBe('Your player name')
  // Only officers may rename players, themselves included.
  expect(rename.outcome).toBe('forbidden')
  expect(describeFor(draft, base, { officer: true })[0].outcome).toBe('ready')
  const left = withoutChange(base, draft, availability.id)
  expect(describeFor(left, base).map((change) => change.id)).toEqual([rename.id])
})
