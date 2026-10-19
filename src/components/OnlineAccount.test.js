import { fireEvent, render, screen } from '@testing-library/svelte'
import { expect, test, vi } from 'vitest'

vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: {
    enabled: true,
    ready: true,
    signedIn: true,
    discordId: '700000000000000001',
    guildId: 'g1',
    guilds: [{ id: 'g1', name: 'Unsanctioned' }],
    joinError: null,
    joining: false,
  },
  createOnlineGuild: vi.fn(async () => 'g2'),
  leaveGuild: vi.fn(),
  localTestSignIn: vi.fn(),
  localTestSignInAvailable: false,
  openGuild: vi.fn(),
  retryDiscordJoin: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../lib/toast.svelte.js', () => ({ showToast: vi.fn() }))

const { openGuild, remote, retryDiscordJoin } = await import('../lib/remote/sync.svelte.js')
const { showToast } = await import('../lib/toast.svelte.js')
const { default: OnlineAccount } = await import('./OnlineAccount.svelte')
const { app } = await import('../lib/app.svelte.js')
const { createDemoState } = await import('../lib/seed.js')

test('a signed-in player without a guild sees the Discord join path', () => {
  remote.guilds = []
  remote.guildId = null
  render(OnlineAccount)
  expect(screen.getByText(/No connected guild found yet/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Create a demo guild online' })).toBeNull()
})

test('a failed Discord check stays visible and can be retried', async () => {
  remote.guilds = []
  remote.guildId = null
  remote.joinError = 'Discord could not be checked.'
  render(OnlineAccount)
  expect(screen.getByRole('alert').textContent).toContain('Discord could not be checked')
  await fireEvent.click(screen.getByRole('button', { name: 'Check my Discord server again' }))
  expect(retryDiscordJoin).toHaveBeenCalledOnce()
  remote.joinError = null
})

test('a sample guild offers owner setup without moving its sample data online', async () => {
  app.data = createDemoState()
  app.showSetup = false
  remote.guildId = 'g1'
  remote.guilds = [{ id: 'g1', name: 'The After Hours (demo)' }]
  render(OnlineAccount)
  expect(screen.queryByRole('button', { name: /Move .* online/ })).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: 'Start your real guild' }))
  expect(app.showSetup).toBe(true)
  app.showSetup = false
  app.data = null
})

test('a failed account action shows its error inside the panel, not in a toast', async () => {
  remote.guilds = [{ id: 'g1', name: 'Unsanctioned' }]
  remote.guildId = null
  openGuild.mockRejectedValueOnce(new Error('Could not reach the server.'))
  showToast.mockClear()
  render(OnlineAccount)
  await fireEvent.click(screen.getByRole('button', { name: 'Unsanctioned' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server.')
  expect(showToast).not.toHaveBeenCalled()
})
