import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'
import { createSeedState } from '../lib/seed.js'
import { app } from '../lib/app.svelte.js'

const ROLES = [
  { id: '700000000000000003', name: 'Raid Officers' },
  { id: '700000000000000005', name: 'Raid Leads' },
]

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { guildId: 'g1', officer: true },
  canManage: () => true,
  flushOnlineChanges: vi.fn(async () => {}),
}))
vi.mock('../lib/discord-channel.svelte.js', () => ({
  discordChannel: { serverId: '700000000000000001' },
}))
vi.mock('../lib/discord-connect.js', () => ({ listDiscordRoles: vi.fn(async () => ROLES) }))
vi.mock('../lib/toast.svelte.js', () => ({ showToast: vi.fn() }))

const { listDiscordRoles } = await import('../lib/discord-connect.js')
const { flushOnlineChanges } = await import('../lib/remote/sync.svelte.js')
const { default: DiscordOfficerRoles } = await import('./DiscordOfficerRoles.svelte')

beforeEach(() => {
  vi.clearAllMocks()
  app.data = createSeedState()
})

test('owner selects officer roles by name and saves verified role IDs', async () => {
  const onsaved = vi.fn()
  render(DiscordOfficerRoles, { props: { onsaved } })
  const officer = await screen.findByRole('checkbox', { name: 'Raid Officers' })
  await fireEvent.click(officer)
  await fireEvent.click(screen.getByRole('button', { name: 'Save officer roles' }))
  await waitFor(() => expect(flushOnlineChanges).toHaveBeenCalledOnce())
  expect(listDiscordRoles).toHaveBeenCalledWith({}, 'g1')
  expect(app.data.guild.officerRoleIds).toBe(ROLES[0].id)
  expect(onsaved).toHaveBeenCalledOnce()
})

test('unsaved raid rule changes block a separate officer role save', async () => {
  render(DiscordOfficerRoles, { props: { settingsDirty: true } })
  await fireEvent.click(await screen.findByRole('checkbox', { name: 'Raid Leads' }))
  expect(screen.getByRole('button', { name: 'Save officer roles' }).disabled).toBe(true)
  expect(screen.getByText(/Save or discard your changes on Raid rules/)).toBeTruthy()
})
