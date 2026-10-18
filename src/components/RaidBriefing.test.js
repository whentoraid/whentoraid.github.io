import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'

vi.mock('../lib/display.svelte.js', () => ({ viewerZone: 'UTC' }))
vi.mock('../lib/raid-briefing.svelte.js', () => ({
  briefingsOnline: () => true,
  loadBriefings: vi.fn(),
  saveBriefing: vi.fn(),
  saveWeekNote: vi.fn(),
  briefings: { data: { raids: {}, notes: [] }, error: '' },
}))

const store = await import('../lib/raid-briefing.svelte.js')
const { default: RaidBriefing } = await import('./RaidBriefing.svelte')
const { default: RaidBriefingEditor } = await import('./RaidBriefingEditor.svelte')

const START = Date.UTC(2026, 8, 30, 20, 0)
const item = { weekIso: SEED_WEEK, raidId: 'raid-20', session: { start: START, end: START + 3 * 3600000 } }
const briefing = {
  assemblyMinutes: 15,
  location: 'Stormwind gates',
  voiceUrl: 'https://discord.gg/abc123',
  contact: 'Sam',
}

beforeEach(() => {
  vi.resetAllMocks()
  app.data = createSeedState()
  store.briefings.data = { raids: { 'raid-20': briefing }, notes: [] }
})
afterEach(() => vi.useRealTimers())

test('on raid day a player sees when and where to meet, the voice link, and who to contact', () => {
  store.briefings.data.notes = [{ week: SEED_WEEK, raidId: 'raid-20', note: 'Second boss first' }]
  render(RaidBriefing, { item, now: START - 3600000 })
  const raidDay = screen.getByRole('region', { name: 'Raid day' })
  expect(raidDay.textContent).toContain('7:45 pm')
  expect(raidDay.textContent).toContain('Stormwind gates')
  expect(raidDay.textContent).toContain('Contact Sam')
  expect(raidDay.textContent).toContain('Second boss first')
  const link = screen.getByRole('link', { name: /Join voice chat/ })
  expect(link.getAttribute('href')).toBe('https://discord.gg/abc123')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  expect(link.textContent).toContain('discord.gg')
})

test('days ahead the details stay folded, and nothing shows without a briefing', () => {
  const { unmount } = render(RaidBriefing, { item, now: START - 3 * 86400000 })
  expect(screen.queryByRole('region', { name: 'Raid day' })).toBeNull()
  expect(screen.getByText('Raid-day details')).toBeTruthy()
  unmount()
  store.briefings.data = { raids: {}, notes: [] }
  const { container } = render(RaidBriefing, { item, now: START - 3600000 })
  expect(container.textContent.trim()).toBe('')
})

test('an unsafe voice link is never rendered as a link', () => {
  store.briefings.data.raids['raid-20'] = { voiceUrl: 'javascript:alert(1)', contact: 'Sam' }
  render(RaidBriefing, { item, now: START - 3600000 })
  expect(screen.queryByRole('link')).toBeNull()
})

test('officers save the raid’s details and a note for one planned week', async () => {
  vi.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z'), toFake: ['Date'] })
  app.data.weeks[SEED_WEEK].plans['raid-20'] = { start: START, team: [], locked: [], attendance: {} }
  store.saveBriefing.mockResolvedValue(null)
  store.saveWeekNote.mockResolvedValue(null)
  render(RaidBriefingEditor)
  expect(screen.getByLabelText('Meeting place').value).toBe('Stormwind gates')
  await fireEvent.input(screen.getByLabelText('Preparation notes'), { target: { value: 'Flasks' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Save raid-day details' }))
  expect(store.saveBriefing).toHaveBeenCalledWith('raid-20', {
    assemblyMinutes: 15,
    location: 'Stormwind gates',
    voiceUrl: 'https://discord.gg/abc123',
    contact: 'Sam',
    notes: 'Flasks',
  })
  await fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'Late pull' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Save week note' }))
  expect(store.saveWeekNote).toHaveBeenCalledWith(SEED_WEEK, 'raid-20', 'Late pull')
})

test('an officer is told when the voice link is not a safe web address', async () => {
  render(RaidBriefingEditor)
  await fireEvent.input(screen.getByLabelText('Voice chat link'), { target: { value: 'http://x.test' } })
  expect(screen.getByText(/starts with https:\/\//)).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Save raid-day details' }))
  expect(store.saveBriefing).not.toHaveBeenCalled()
})
