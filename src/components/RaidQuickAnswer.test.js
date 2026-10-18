import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({ remote: { guildId: 'g1' }, canManage: () => false }))
vi.mock('../lib/raid-services.js', () => ({ saveAppSignup: vi.fn(async () => ({})) }))

const services = await import('../lib/raid-services.js')
const { app } = await import('../lib/app.svelte.js')
const { createSeedState, SEED_WEEK } = await import('../lib/seed.js')
const { toast } = await import('../lib/toast.svelte.js')
const { default: RaidQuickAnswer } = await import('./RaidQuickAnswer.svelte')

const NOW = Date.parse('2026-09-28T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  app.data = createSeedState()
  const start = Date.parse('2026-10-02T23:30:00Z')
  app.data.weeks[SEED_WEEK].plans['raid-20'] = {
    start,
    team: [],
    published: { start, end: start + 3 * 3600000, publishedAt: 1, team: [] },
  }
  // A player without an answer for the week yet, so Undo takes the sign-up back.
  delete app.data.weeks[SEED_WEEK].checkins.m0
})

afterEach(() => vi.useRealTimers())

const group = () => screen.getAllByRole('group', { name: /Your answer for/ })[0]

test('an answer in the app goes on the raid’s Discord sign-up list too', async () => {
  render(RaidQuickAnswer, { memberId: 'm0', weekIso: SEED_WEEK, now: NOW })
  await fireEvent.click(within(group()).getByRole('button', { name: 'Tentative' }))
  expect(services.saveAppSignup).toHaveBeenCalledWith({}, 'g1', {
    weekIso: SEED_WEEK,
    raidId: 'raid-20',
    memberId: 'm0',
    answer: 'tentative',
    characterId: expect.anything(),
  })
})

test('Undo takes the Discord sign-up back to the earlier answer', async () => {
  render(RaidQuickAnswer, { memberId: 'm0', weekIso: SEED_WEEK, now: NOW })
  await fireEvent.click(within(group()).getByRole('button', { name: 'Can’t make it' }))
  toast.action.run()
  expect(services.saveAppSignup).toHaveBeenLastCalledWith({}, 'g1', expect.objectContaining({ answer: null }))
})

test('a sign-up list that fails to update says the answer is saved and offers to try again', async () => {
  services.saveAppSignup.mockRejectedValueOnce(new Error('Sign-ups for this raid have closed.'))
  render(RaidQuickAnswer, { memberId: 'm0', weekIso: SEED_WEEK, now: NOW })
  await fireEvent.click(within(group()).getByRole('button', { name: 'I’m in' }))
  await vi.waitFor(() => expect(toast.message).toMatch(/Your answer is saved, but the Discord sign-up list/))
  expect(toast.action.label).toBe('Try again')
})
