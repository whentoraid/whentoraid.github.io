import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { guildId: 'g1' },
  flushOnlineChanges: vi.fn(async () => {}),
}))
vi.mock('../lib/raid-services.js', () => ({ getRaidHistory: vi.fn(), explainRaidChange: vi.fn() }))
vi.mock('../lib/toast.svelte.js', () => ({ showToast: vi.fn() }))

const services = await import('../lib/raid-services.js')
const sync = await import('../lib/remote/sync.svelte.js')
const { default: RaidHistoryPanel } = await import('./RaidHistoryPanel.svelte')
const { default: RaidChangeLog } = await import('./RaidChangeLog.svelte')

// Far enough ahead that the raid has not started whenever the tests run.
const START = Date.parse('2030-01-11T19:00:00Z')
const ash = { memberId: 'm0', characterId: 'c0a', role: 'Tank' }
const briar = { memberId: 'm1', characterId: 'c1a', role: 'Tank' }
const change = {
  id: 'e1',
  at: '2026-10-01T18:00:00Z',
  actor_member_id: 'm0',
  actor_name: 'Adam',
  kind: 'draft',
  visibility: 'officers',
  affects: [],
  details: { roster: { added: [ash], removed: [briar], changed: [] } },
  before: { start: START, team: [briar], locked: [] },
  reason: null,
}

async function openPanel(container) {
  const details = container.querySelector('details')
  details.open = true
  await fireEvent(details, new Event('toggle'))
}

beforeEach(() => {
  vi.resetAllMocks()
  const state = createSeedState()
  state.weeks[SEED_WEEK].plans['raid-20'] = {
    start: START,
    team: [ash],
    locked: [],
    attendance: {},
    cancelled: false,
  }
  app.data = state
})

test('officers read who changed the raid, and explain a change', async () => {
  services.getRaidHistory.mockResolvedValue([change])
  services.explainRaidChange.mockResolvedValue(null)
  const { container } = render(RaidHistoryPanel, { weekIso: SEED_WEEK, raidId: 'raid-20', zone: 'UTC' })
  expect(services.getRaidHistory).not.toHaveBeenCalled()
  await openPanel(container)

  expect(await screen.findByText('Adam changed the draft roster')).toBeTruthy()
  expect(screen.getByText('Added Adam (Stoneguard, Tank)')).toBeTruthy()
  expect(screen.getByText('Removed Briar')).toBeTruthy()

  await fireEvent.click(screen.getByRole('button', { name: 'Add a reason' }))
  await fireEvent.input(screen.getByLabelText(/Why was this changed/), { target: { value: 'Briar is away' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Save reason' }))
  expect(services.explainRaidChange).toHaveBeenCalledWith({}, 'g1', 'e1', 'Briar is away')
})

test('restoring the earlier roster previews it, then makes it the draft', async () => {
  services.getRaidHistory.mockResolvedValue([change])
  const { container } = render(RaidHistoryPanel, { weekIso: SEED_WEEK, raidId: 'raid-20', zone: 'UTC' })
  await openPanel(container)
  await fireEvent.click(await screen.findByRole('button', { name: 'Restore the roster from before this' }))

  expect(screen.getByText('Back on the draft: Briar')).toBeTruthy()
  expect(screen.getByText('Off the draft: Adam')).toBeTruthy()
  expect(app.data.weeks[SEED_WEEK].plans['raid-20'].team).toEqual([ash])

  await fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }))
  expect(app.data.weeks[SEED_WEEK].plans['raid-20'].team).toEqual([briar])
  await waitFor(() => expect(sync.flushOnlineChanges).toHaveBeenCalled())
})

test('a failed load says so and can be retried', async () => {
  services.getRaidHistory.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce([])
  const { container } = render(RaidHistoryPanel, { weekIso: SEED_WEEK, raidId: 'raid-20', zone: 'UTC' })
  await openPanel(container)
  expect(await screen.findByText(/Couldn’t load the history: Network error/)).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText(/No changes recorded yet/)).toBeTruthy()
})

test('players see what a published change meant for them, with the reason', async () => {
  services.getRaidHistory.mockResolvedValue([
    {
      ...change,
      kind: 'published',
      visibility: 'members',
      affects: ['m1'],
      details: { republished: true, roster: { added: [], removed: [briar], changed: [] } },
      before: null,
      reason: 'Briar asked to sit out',
    },
  ])
  const item = { weekIso: SEED_WEEK, raidId: 'raid-20', plan: { publishedAt: 2 } }
  render(RaidChangeLog, { item, memberId: 'm1' })
  expect(await screen.findByText('Adam republished the roster')).toBeTruthy()
  expect(screen.getByText('You are no longer on the roster.')).toBeTruthy()
  expect(screen.getByText('Why: Briar asked to sit out')).toBeTruthy()
})

test('the change log stays hidden when there is nothing to show or it cannot load', async () => {
  services.getRaidHistory.mockRejectedValue(new Error('offline'))
  const item = { weekIso: SEED_WEEK, raidId: 'raid-20', plan: { publishedAt: 2 } }
  const { container } = render(RaidChangeLog, { item, memberId: 'm1' })
  await waitFor(() => expect(services.getRaidHistory).toHaveBeenCalled())
  expect(container.querySelector('details')).toBeNull()
})
