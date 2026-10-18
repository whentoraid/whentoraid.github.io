import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { guildId: 'g1', memberId: 'm0' },
  canManage: () => false,
}))
vi.mock('../lib/raid-services.js', () => ({
  listRaidStandby: vi.fn(async () => []),
  listRaidOffers: vi.fn(async () => []),
  setRaidStandby: vi.fn(async () => null),
  offerRaidPlace: vi.fn(async () => 'offer-1'),
  withdrawRaidOffer: vi.fn(async () => null),
  respondToRaidOffer: vi.fn(async () => 'accepted'),
}))

const services = await import('../lib/raid-services.js')
const { app } = await import('../lib/app.svelte.js')
const { createSeedState, SEED_WEEK } = await import('../lib/seed.js')
const { standbyWeeks } = await import('../lib/standby.svelte.js')
const { default: StandbyOffer } = await import('./StandbyOffer.svelte')
const { default: StandbyOffersPanel } = await import('./StandbyOffersPanel.svelte')

const HOUR = 3_600_000
const NOW = Date.parse('2026-09-28T12:00:00Z')
const START = NOW + 48 * HOUR
const item = {
  weekIso: SEED_WEEK,
  raidId: 'raid-20',
  raid: { name: '20-player Raid' },
  session: { start: START },
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(standbyWeeks)) delete standbyWeeks[key]
  app.data = createSeedState()
})

const characterOf = (memberId) => app.data.characters.find((c) => c.memberId === memberId)
const offer = (overrides = {}) => ({
  id: 'offer-1',
  raid_id: 'raid-20',
  vacated_member_id: 'm1',
  role: 'Tank',
  member_id: 'm0',
  character_id: characterOf('m0').id,
  expires_at: new Date(NOW + 2 * HOUR).toISOString(),
  status: 'open',
  created_at: new Date(NOW).toISOString(),
  responded_at: null,
  ...overrides,
})

test('a player without a place goes on standby', async () => {
  render(StandbyOffer, { item, memberId: 'm0', now: NOW })
  await fireEvent.click(await screen.findByRole('button', { name: 'Be on standby' }))
  expect(services.setRaidStandby).toHaveBeenCalledWith({}, 'g1', {
    week: SEED_WEEK,
    raidId: 'raid-20',
    on: true,
    characterId: null,
    untilMs: null,
  })
})

test('a player on standby can leave it', async () => {
  services.listRaidStandby.mockResolvedValueOnce([
    { raid_id: 'raid-20', member_id: 'm0', character_id: null, until_ms: null },
  ])
  render(StandbyOffer, { item, memberId: 'm0', now: NOW })
  await fireEvent.click(await screen.findByRole('button', { name: 'Leave standby' }))
  expect(services.setRaidStandby).toHaveBeenCalledWith({}, 'g1', expect.objectContaining({ on: false }))
})

test('an offered place shows its deadline and can be accepted', async () => {
  services.listRaidOffers.mockResolvedValueOnce([offer()])
  render(StandbyOffer, { item, memberId: 'm0', now: NOW })
  expect(await screen.findByText(/You’re offered a place/)).toBeTruthy()
  expect(screen.getByText(/2 h left/)).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Accept the place' }))
  expect(services.respondToRaidOffer).toHaveBeenCalledWith({}, 'g1', 'offer-1', true)
})

test('an offer someone else took first says so instead of asking', async () => {
  services.listRaidOffers.mockResolvedValueOnce([offer({ status: 'filled' })])
  render(StandbyOffer, { item, memberId: 'm0', now: NOW })
  expect(await screen.findByText('Someone else accepted the place you were offered first.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Accept the place' })).toBeNull()
})

const published = () => ({
  start: START,
  end: START + 3 * HOUR,
  publishedAt: 1,
  team: [{ memberId: 'm1', characterId: characterOf('m1').id, role: characterOf('m1').role }],
})

test('officers offer a published place to a standby player first, closing by the raid’s start', async () => {
  const team = published()
  const role = team.team[0].role
  const waiting = app.data.characters.findLast((c) => c.memberId !== 'm1' && c.role === role && !c.retired)
  services.listRaidStandby.mockResolvedValueOnce([
    { raid_id: 'raid-20', member_id: waiting.memberId, character_id: waiting.id, until_ms: null },
  ])
  render(StandbyOffersPanel, {
    week: SEED_WEEK,
    raidId: 'raid-20',
    published: team,
    byMember: { m1: { status: 'unavailable' } },
    canPlace: () => true,
    onplace: vi.fn(),
  })
  const place = await screen.findByRole('combobox', { name: 'Place' })
  await fireEvent.change(place, { target: { value: 'm1' } })
  const player = screen.getByRole('combobox', { name: 'Offer to' })
  expect(player.querySelectorAll('option')[1].value).toBe(waiting.id)
  expect(player.querySelectorAll('option')[1].textContent).toMatch(/^On standby: /)
  await fireEvent.change(player, { target: { value: waiting.id } })
  await fireEvent.click(screen.getByRole('button', { name: 'Offer place' }))
  expect(services.offerRaidPlace).toHaveBeenCalledWith({}, 'g1', {
    week: SEED_WEEK,
    raidId: 'raid-20',
    vacatedMemberId: 'm1',
    memberId: waiting.memberId,
    characterId: waiting.id,
    expiresAt: expect.any(Number),
  })
  expect(services.offerRaidPlace.mock.calls[0][2].expiresAt).toBeLessThanOrEqual(START)
})

test('an accepted offer can be put in the draft', async () => {
  const onplace = vi.fn()
  services.listRaidOffers.mockResolvedValueOnce([offer({ status: 'accepted' })])
  render(StandbyOffersPanel, {
    week: SEED_WEEK,
    raidId: 'raid-20',
    published: published(),
    byMember: {},
    canPlace: () => true,
    onplace,
  })
  await fireEvent.click(await screen.findByRole('button', { name: /in the draft/ }))
  expect(onplace).toHaveBeenCalledWith(expect.objectContaining({ id: 'offer-1', status: 'accepted' }))
})
