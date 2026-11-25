import { render, screen } from '@testing-library/svelte'
import { expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState } from '../lib/seed.js'
import { remote } from '../lib/remote/sync.svelte.js'
import Profile from './Profile.svelte'

vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { guildId: null, memberId: null },
}))

test('Profile groups character management and raid history outside the weekly flow', () => {
  app.data = createSeedState()
  render(Profile)
  expect(screen.getByRole('heading', { name: 'Profile', level: 1 })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Your characters' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Add character/ })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Raid history' })).toBeTruthy()
  expect(screen.queryByText('Private calendar link')).toBeNull()
})

test('online members find their private calendar and reminder controls in Profile', () => {
  app.data = createSeedState()
  Object.assign(remote, { guildId: 'guild-1', memberId: 'm0' })
  try {
    render(Profile)
    expect(screen.getByRole('region', { name: 'Personal settings' })).toBeTruthy()
    expect(screen.getByText('Private calendar link', { selector: 'summary' })).toBeTruthy()
    expect(screen.getByText('Discord reminders', { selector: 'summary' })).toBeTruthy()
  } finally {
    Object.assign(remote, { guildId: null, memberId: null })
  }
})
