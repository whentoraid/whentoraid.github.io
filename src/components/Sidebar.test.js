import { render, screen, within } from '@testing-library/svelte'
import { expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState } from '../lib/seed.js'
import Sidebar from './Sidebar.svelte'

// An online player, not an officer.
vi.mock('../lib/remote/sync.svelte.js', () => ({
  canManage: () => false,
  remote: { guildId: 'test', status: 'saved' },
}))

test('a player sees read-only guild pages and no Guild settings', () => {
  app.data = createSeedState()
  render(Sidebar)
  const guild = screen.getByRole('navigation', { name: 'Guild' })
  expect(within(guild).getByRole('button', { name: 'Guild rosters' })).toBeTruthy()
  expect(within(guild).getByRole('button', { name: 'Guild members' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Guild settings' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Raid planner' })).toBeNull()
})
