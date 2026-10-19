import { describe, expect, test } from 'vitest'
import { describeChange, memberView, restorePreview, restoreRoster } from './raid-history.js'
import { createSeedState, SEED_WEEK } from './seed.js'

const ZONE = 'UTC'
const START = Date.parse('2026-10-02T19:00:00Z')
const BEFORE = START - 86400000
const ash = { memberId: 'm0', characterId: 'c0a', role: 'Tank' }
const ashHealer = { memberId: 'm0', characterId: 'c0b', role: 'Healer' }
const briar = { memberId: 'm1', characterId: 'c1a', role: 'Tank' }
const lumina = { memberId: 'm2', characterId: 'c2a', role: 'Healer' }

function stateWithDraft(team, extra = {}) {
  const state = createSeedState()
  state.weeks[SEED_WEEK].plans['raid-20'] = {
    start: START,
    team,
    locked: [],
    attendance: {},
    cancelled: false,
    published: { start: START, team: [ash], publishedAt: 1 },
    ...extra,
  }
  return state
}

const event = (overrides) => ({
  id: 'e1',
  at: '2026-10-01T18:00:00Z',
  actor_member_id: 'm0',
  actor_name: 'Adam',
  kind: 'draft',
  visibility: 'officers',
  affects: [],
  details: {},
  before: null,
  reason: null,
  ...overrides,
})

describe('describing a change', () => {
  test('names who changed the draft and every roster and time change', () => {
    const { headline, lines } = describeChange(
      event({
        details: {
          roster: { added: [briar], removed: [lumina], changed: [{ from: ash, to: ashHealer }] },
          fromStart: START,
          toStart: START + 3600000,
        },
      }),
      createSeedState(),
      ZONE,
    )
    expect(headline).toBe('Adam changed the draft roster')
    expect(lines).toEqual([
      'Added Briar (Moonbriar, Tank)',
      'Removed Mira',
      'Adam: Stoneguard (Tank) → Stoneguardalt (Healer)',
      'Time: Fri, Oct 2, 7:00 PM → Fri, Oct 2, 8:00 PM',
    ])
  })

  test('attendance changes, and changes made by the server', () => {
    const text = describeChange(
      event({
        kind: 'attendance',
        actor_name: null,
        details: { attendance: { m1: { from: null, to: 'noshow' } } },
      }),
      createSeedState(),
      ZONE,
    )
    expect(text).toEqual({
      headline: 'WhenToRaid updated attendance',
      lines: ['Briar: not marked → no-show'],
    })
  })

  test('a player sees only what it meant for their own place', () => {
    const republished = event({
      kind: 'published',
      details: { republished: true, roster: { added: [briar], removed: [lumina], changed: [] } },
    })
    expect(memberView(republished, createSeedState(), 'm1', ZONE)).toEqual({
      headline: 'Adam republished the roster',
      lines: ['You were added to the roster.'],
    })
    expect(memberView(republished, createSeedState(), 'm2', ZONE).lines).toEqual([
      'You are no longer on the roster.',
    ])
  })
})

describe('restoring an earlier roster', () => {
  test('previews who comes back and leaves, and keeps the current time', () => {
    const state = stateWithDraft([lumina])
    const preview = restorePreview(
      state,
      SEED_WEEK,
      'raid-20',
      { start: START - 3600000, team: [ash, briar], locked: ['m1'] },
      BEFORE,
    )
    expect(preview).toMatchObject({
      team: [ash, briar],
      locked: ['m1'],
      start: START,
      joins: ['m0', 'm1'],
      leaves: ['m2'],
      dropped: [],
      timeKept: true,
    })
  })

  test('leaves out players who can no longer be placed, with the reason', () => {
    const state = stateWithDraft([])
    state.characters = state.characters.map((c) => (c.id === 'c1a' ? { ...c, retired: true } : c))
    const preview = restorePreview(
      state,
      SEED_WEEK,
      'raid-20',
      { start: START, team: [ash, briar, { memberId: 'gone', characterId: 'x', role: 'DPS' }] },
      BEFORE,
    )
    expect(preview.team).toEqual([ash])
    expect(preview.dropped.map((d) => d.reason)).toEqual([
      'that character was deleted',
      'no longer in the guild',
    ])
  })

  test('is refused once the raid has started or while it is cancelled', () => {
    const started = restorePreview(
      stateWithDraft([]),
      SEED_WEEK,
      'raid-20',
      { start: START, team: [] },
      START,
    )
    expect(started.error).toMatch(/has started/)
    const cancelled = stateWithDraft([], { cancelled: true })
    expect(restorePreview(cancelled, SEED_WEEK, 'raid-20', { start: START, team: [] }, BEFORE).error).toMatch(
      /cancelled/,
    )
  })

  test('changes only the draft: the published roster stays as it is', () => {
    const state = { ...stateWithDraft([lumina]), currentRaidId: 'raid-10-1' }
    const preview = restorePreview(state, SEED_WEEK, 'raid-20', { start: START, team: [briar] }, BEFORE)
    const next = restoreRoster(state, SEED_WEEK, 'raid-20', preview)
    const plan = next.weeks[SEED_WEEK].plans['raid-20']
    expect(plan.team).toEqual([briar])
    expect(plan.published).toEqual(state.weeks[SEED_WEEK].plans['raid-20'].published)
    expect(next.currentRaidId).toBe('raid-10-1')
  })
})
