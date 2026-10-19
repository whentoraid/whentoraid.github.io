import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { enabled: true, ready: true, signedIn: false, guildId: null, guilds: [] },
  openGuild: vi.fn(async () => {}),
  signIn: vi.fn(),
}))

const { openGuild, remote, signIn } = await import('../lib/remote/sync.svelte.js')
const { default: BrowserGuildBanner } = await import('./BrowserGuildBanner.svelte')
const { app } = await import('../lib/app.svelte.js')
const { createSeedState } = await import('../lib/seed.js')

afterEach(() => {
  Object.assign(remote, { enabled: true, ready: true, signedIn: false, guildId: null, guilds: [] })
  app.data = null
})

test('a signed-out player in a browser guild is told it is not their guild and can sign in', async () => {
  app.data = createSeedState()
  render(BrowserGuildBanner)
  expect(screen.getByRole('alert').textContent).toMatch(/saved only in this browser/)
  expect(screen.getByRole('alert').textContent).toMatch(/never reach your guild or Discord/)
  await fireEvent.click(screen.getByRole('button', { name: 'Sign in with Discord' }))
  expect(signIn).toHaveBeenCalledOnce()
})

test('a signed-in player in a browser guild can open their one online guild', async () => {
  app.data = createSeedState()
  remote.signedIn = true
  remote.guilds = [{ id: 'g1', name: 'Distracted Minds' }]
  render(BrowserGuildBanner)
  await fireEvent.click(screen.getByRole('button', { name: 'Open Distracted Minds' }))
  expect(openGuild).toHaveBeenCalledWith('g1')
})

test('nothing is shown while an online guild is open, or on a site without a server', () => {
  app.data = createSeedState()
  remote.guildId = 'g1'
  const online = render(BrowserGuildBanner)
  expect(screen.queryByRole('alert')).toBeNull()
  online.unmount()
  remote.guildId = null
  remote.enabled = false
  render(BrowserGuildBanner)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('nothing is shown while sign-in is still being checked', () => {
  app.data = createSeedState()
  remote.ready = false
  render(BrowserGuildBanner)
  expect(screen.queryByRole('alert')).toBeNull()
})
