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

test('a player sees only their own raid week: raids, availability and characters', () => {
  app.data = createSeedState()
  render(Sidebar)
  const mine = screen.getByRole('navigation', { name: 'Your raid week' })
  for (const label of ['My raids', 'My availability', 'My characters']) {
    expect(within(mine).getByRole('button', { name: label })).toBeTruthy()
  }
  expect(screen.queryByRole('navigation', { name: 'Guild tools' })).toBeNull()
  for (const label of [
    'Officer dashboard',
    'Raid planner',
    'Guild rosters',
    'Guild members',
    'Guild settings',
  ]) {
    expect(screen.queryByRole('button', { name: label })).toBeNull()
  }
})
