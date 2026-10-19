import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
import Officer from './Officer.svelte'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse('2026-09-28T12:00:00Z'))
  app.data = createSeedState()
  const start = Date.parse('2026-10-02T23:30:00Z')
  app.data.weeks[SEED_WEEK].plans['raid-20'] = {
    start: start + 60000,
    team: [],
    published: {
      start,
      end: start + 3 * 3600000,
      publishedAt: 1000,
      team: [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }],
    },
  }
})

afterEach(() => vi.useRealTimers())

test('a dashboard issue opens the planner at the tool that resolves it', async () => {
  render(Officer)
  const dashboard = screen.getByRole('region', { name: 'Officer dashboard' })
  await fireEvent.click(
    within(dashboard).getByRole('button', { name: /^Find Tank candidates: 20-player Raid/ }),
  )
  expect(app.view).toBe('planner')
  expect(app.plannerIntent).toEqual({ section: 'roster', focus: 'add', role: 'Tank' })
  expect(app.returnTo).toBe(`${SEED_WEEK}/raid-20`)
  expect(app.data.currentRaidId).toBe('raid-20')
})

test('returning from the planner brings the raid the officer left from back into focus', () => {
  app.dashboardFocus = `${SEED_WEEK}/raid-20`
  render(Officer)
  const dashboard = screen.getByRole('region', { name: 'Officer dashboard' })
  const row = dashboard.querySelector(`[data-row="${SEED_WEEK}/raid-20"]`)
  expect(row.contains(document.activeElement)).toBe(true)
  expect(app.dashboardFocus).toBeNull()
})
