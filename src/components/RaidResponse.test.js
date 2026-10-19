import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/raid-responses.svelte.js', () => ({
  canRespondAs: () => true,
  loadRaidResponses: vi.fn(),
  respondToRaid: vi.fn(),
  responseKey: (week, raidId, published) => `${week}|${raidId}|${published?.publishedAt}`,
}))

const responses = await import('../lib/raid-responses.svelte.js')
const { default: RaidResponse } = await import('./RaidResponse.svelte')

const item = { weekIso: '2026-10-19', raidId: 'raid-20', plan: { publishedAt: 1 } }

beforeEach(() => {
  vi.resetAllMocks()
  responses.loadRaidResponses.mockResolvedValue({})
})

test('a confirmation is never shown as saved until the server accepts it, and Try again resends it', async () => {
  responses.respondToRaid.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce(undefined)
  render(RaidResponse, { item, memberId: 'm1' })
  await fireEvent.click(await screen.findByRole('button', { name: 'I’ll be there' }))
  expect(await screen.findByText(/Your answer was not saved: Network error/)).toBeTruthy()
  expect(screen.queryByText(/confirmed you’ll be there/)).toBeNull()

  await fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText(/You confirmed you’ll be there/)).toBeTruthy()
  expect(responses.respondToRaid).toHaveBeenCalledTimes(2)
})

test('Try again does not resend an answer the server already has', async () => {
  responses.respondToRaid.mockRejectedValueOnce(new Error('Network error'))
  render(RaidResponse, { item, memberId: 'm1' })
  await fireEvent.click(await screen.findByRole('button', { name: 'Tentative' }))
  await screen.findByText(/not saved/)
  responses.loadRaidResponses.mockResolvedValue({ m1: { member_id: 'm1', status: 'tentative', note: '' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText(/You’re tentative/)).toBeTruthy()
  expect(responses.respondToRaid).toHaveBeenCalledTimes(1)
})

test('after the roster is republished, the old answer is not offered again', async () => {
  responses.respondToRaid.mockRejectedValueOnce(new Error('Network error'))
  const { rerender } = render(RaidResponse, { item, memberId: 'm1' })
  await fireEvent.click(await screen.findByRole('button', { name: 'I’ll be there' }))
  await screen.findByText(/not saved/)
  await rerender({ item: { ...item, plan: { publishedAt: 2 } }, memberId: 'm1' })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull())
  expect(responses.respondToRaid).toHaveBeenCalledTimes(1)
})
