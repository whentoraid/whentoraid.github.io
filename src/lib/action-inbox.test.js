import { beforeEach, describe, expect, test } from 'vitest'
import { memberActions, raidAnchor } from './action-inbox.js'
import { createSeedState, SEED_WEEK } from './seed.js'

const NOW = Date.parse('2026-09-28T12:00:00Z')
const START = Date.parse('2026-10-02T23:30:00Z')
const KEY = `${SEED_WEEK}:raid-20`
let state

beforeEach(() => {
  state = createSeedState()
  state.weeks[SEED_WEEK].plans['raid-20'] = {
    start: START,
    team: [],
    published: {
      start: START,
      end: START + 3 * 3600000,
      publishedAt: 1000,
      team: [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }],
    },
  }
})

const kinds = (actions) => actions.map((action) => action.kind)
const offer = (overrides) => ({
  id: 'offer-1',
  member_id: 'm1',
  week: SEED_WEEK,
  raid_id: 'raid-20',
  status: 'open',
  expires_at: '2026-09-28T15:00:00Z',
  ...overrides,
})
/** A player who has neither checked in this week nor kept a usual schedule. */
function withoutAnswer(memberId) {
  const { [memberId]: _checkin, ...checkins } = state.weeks[SEED_WEEK].checkins
  const { [memberId]: _template, ...templates } = state.templates
  return {
    ...state,
    templates,
    weeks: { ...state.weeks, [SEED_WEEK]: { ...state.weeks[SEED_WEEK], checkins } },
  }
}

describe('a rostered player’s confirmation', () => {
  test('is asked for until they answer, and points at the raid on Home', () => {
    const [action] = memberActions(state, 'm0', { now: NOW, thisWeek: SEED_WEEK, responses: { [KEY]: null } })
    expect(action).toMatchObject({ kind: 'confirm', anchor: raidAnchor(SEED_WEEK, 'raid-20'), due: START })
    expect(action.title).toBe('Confirm your place in 20-player Raid')
  })

  test('disappears once answered in the app or on Discord', () => {
    for (const status of ['confirmed', 'unavailable'])
      expect(
        kinds(memberActions(state, 'm0', { now: NOW, thisWeek: SEED_WEEK, responses: { [KEY]: status } })),
      ).not.toContain('confirm')
  })

  test('is not claimed before the answers have loaded', () => {
    expect(kinds(memberActions(state, 'm0', { now: NOW, thisWeek: SEED_WEEK }))).not.toContain('confirm')
  })

  test('is no longer asked for once the raid has started', () => {
    const now = START + 60_000
    expect(
      kinds(memberActions(state, 'm0', { now, thisWeek: SEED_WEEK, responses: { [KEY]: null } })),
    ).not.toContain('confirm')
  })
})

describe('a place offer', () => {
  test('is listed while open for this player only', () => {
    const offers = [offer(), offer({ id: 'offer-2', member_id: 'm2' })]
    const actions = memberActions(state, 'm1', { now: NOW, thisWeek: SEED_WEEK, offers })
    expect(actions.filter((a) => a.kind === 'offer').map((a) => a.id)).toEqual(['offer:offer-1'])
  })

  test('drops out once answered, filled or past its deadline', () => {
    const offers = [
      offer({ status: 'accepted' }),
      offer({ id: 'offer-2', status: 'filled' }),
      offer({ id: 'offer-3', expires_at: '2026-09-28T11:00:00Z' }),
    ]
    expect(kinds(memberActions(state, 'm1', { now: NOW, thisWeek: SEED_WEEK, offers }))).not.toContain(
      'offer',
    )
  })
})

describe('this week’s availability', () => {
  test('is asked for while the week is open and the player has not answered', () => {
    const actions = memberActions(withoutAnswer('m1'), 'm1', { now: NOW, thisWeek: SEED_WEEK })
    expect(actions.find((a) => a.kind === 'availability')?.title).toBe(
      'Give your availability for Sep 28 – Oct 4',
    )
  })

  test('is not asked for once the player has checked in', () => {
    expect(kinds(memberActions(state, 'm0', { now: NOW, thisWeek: SEED_WEEK }))).not.toContain('availability')
  })
})

test('the soonest deadline comes first', () => {
  const actions = memberActions(state, 'm0', {
    now: NOW,
    thisWeek: SEED_WEEK,
    responses: { [KEY]: null },
    offers: [offer({ member_id: 'm0' })],
  })
  expect(kinds(actions)).toEqual(['offer', 'confirm'])
})

test('nobody signed in has nothing to do', () => {
  expect(memberActions(state, '', { now: NOW, thisWeek: SEED_WEEK })).toEqual([])
})
