import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({ remote: { guildId: 'g1' } }))
vi.mock('../lib/raid-services.js', () => ({
  getReminderSettings: vi.fn(),
  setReminderSettings: vi.fn(),
}))

const services = await import('../lib/raid-services.js')
const { default: ReminderSettings } = await import('./ReminderSettings.svelte')
const { discordChannel } = await import('../lib/discord-channel.svelte.js')
beforeEach(() => {
  vi.resetAllMocks()
  discordChannel.channelId = ''
  services.getReminderSettings.mockResolvedValue({
    checkin_enabled: false,
    upcoming_enabled: false,
    interval_hours: 24,
    lead_hours: 24,
    only_unconfirmed: true,
    signup_enabled: false,
    signup_lead_days: 7,
  })
})

test('interactive sign-ups require a bot channel', async () => {
  render(ReminderSettings)
  const signup = await screen.findByRole('checkbox', { name: 'Post sign-ups for upcoming raids' })
  expect(signup.disabled).toBe(true)
  expect(screen.getByText(/Choose a WhenToRaid bot channel above/)).toBeTruthy()
  discordChannel.channelId = '800000000000000001'
  await vi.waitFor(() => expect(signup.disabled).toBe(false))
})

test('retrying a failed load restores the saved settings without enabling reminders', async () => {
  services.getReminderSettings.mockRejectedValueOnce(new Error('Offline'))
  render(ReminderSettings)
  expect((await screen.findByRole('alert')).textContent).toMatch(/Offline/)
  await fireEvent.click(screen.getByRole('button', { name: 'Retry reminder settings' }))
  expect((await screen.findByRole('checkbox', { name: /before a published raid/ })).checked).toBe(false)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: 'Save reminders' }).disabled).toBe(true)
  expect(services.setReminderSettings).not.toHaveBeenCalled()
})

test('fields stay disabled while saving so a delayed response cannot erase a new edit', async () => {
  let finish
  services.setReminderSettings.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  render(ReminderSettings)
  const toggle = await screen.findByRole('checkbox', { name: /before a published raid/ })
  await fireEvent.click(toggle)
  await fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }))
  expect(toggle.closest('fieldset').disabled).toBe(true)
  finish()
  await vi.waitFor(() => expect(toggle.closest('fieldset').disabled).toBe(false))
  expect(toggle.checked).toBe(true)
})
