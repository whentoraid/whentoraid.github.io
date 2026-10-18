import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({ remote: { guildId: 'g1' } }))
vi.mock('../lib/display.svelte.js', () => ({ viewerZone: 'America/New_York' }))
vi.mock('../lib/raid-services.js', () => ({ getMyReminderPrefs: vi.fn(), setMyReminderPrefs: vi.fn() }))

const services = await import('../lib/raid-services.js')
const { default: ReminderPreferences } = await import('./ReminderPreferences.svelte')
beforeEach(() => {
  vi.resetAllMocks()
  services.getMyReminderPrefs.mockResolvedValue({
    ping: true,
    quiet_start: null,
    quiet_end: null,
    timezone: null,
  })
  services.setMyReminderPrefs.mockResolvedValue(null)
})

test('a player sets quiet hours in their own timezone', async () => {
  render(ReminderPreferences, { discordLinked: true })
  expect(await screen.findByText(/Pings on/)).toBeTruthy()
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Don’t ping me during quiet hours' }))
  await fireEvent.input(screen.getByLabelText('From'), { target: { value: '23:00' } })
  await fireEvent.input(screen.getByLabelText('Until'), { target: { value: '07:30' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Save reminder preferences' }))
  expect(services.setMyReminderPrefs).toHaveBeenCalledWith({}, 'g1', {
    ping: true,
    quietStart: 1380,
    quietEnd: 450,
    timezone: 'America/New_York',
  })
  expect(await screen.findByText(/quiet 11:00 pm–7:30 am/)).toBeTruthy()
})

test('turning pings off saves no quiet hours and says the post still appears', async () => {
  render(ReminderPreferences, { discordLinked: true })
  await fireEvent.click(await screen.findByRole('checkbox', { name: 'Ping me when a reminder names me' }))
  expect(screen.queryByRole('checkbox', { name: 'Don’t ping me during quiet hours' })).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: 'Save reminder preferences' }))
  expect(services.setMyReminderPrefs).toHaveBeenCalledWith({}, 'g1', {
    ping: false,
    quietStart: null,
    quietEnd: null,
    timezone: 'America/New_York',
  })
  expect(screen.getByText(/the post stays in the channel for everyone/)).toBeTruthy()
})

test('a player without linked Discord is told reminders cannot ping them', async () => {
  render(ReminderPreferences, { discordLinked: false })
  expect(screen.getByText(/isn’t linked to this guild/)).toBeTruthy()
})

test('a failed load can be retried', async () => {
  services.getMyReminderPrefs.mockRejectedValueOnce(new Error('Offline'))
  render(ReminderPreferences, { discordLinked: true })
  expect((await screen.findByRole('alert')).textContent).toMatch(/Offline/)
  await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('checkbox', { name: 'Ping me when a reminder names me' })).toBeTruthy()
})
