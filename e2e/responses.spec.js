import { navigate } from './helpers.js'
import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/lib/seed.js'

test('a player marks tentative, confirms, then reports a problem for an officer to replace', async ({
  page,
}) => {
  // The fixture's week, before its raid nights, so the published raid is still upcoming.
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'))
  await page.addInitScript(
    (state) => localStorage.setItem('whentoraid-v3', JSON.stringify(state)),
    createSeedState(),
  )
  await page.goto('./#/planner')
  await page.getByRole('button', { name: 'Publish roster' }).click()

  // As the player (the fixture's current member is on the roster).
  await page.getByRole('button', { name: 'Raids', exact: true }).click()
  const next = page.getByRole('region', { name: 'Next raid assignment' })
  await expect(next.getByText('SELECTED', { exact: true })).toBeVisible()
  const agenda = page.getByRole('region', { name: 'Upcoming raids' })
  const raid = agenda.getByRole('listitem').filter({ hasText: '20-player Raid' })
  await raid.getByRole('button', { name: 'Tentative' }).click()
  await expect(raid.getByText(/You’re tentative/)).toBeVisible()

  await navigate(page, 'Raid planner')
  await page.getByRole('tab', { name: 'Responses' }).click()
  const responses = page.getByRole('region', { name: 'Player responses' })
  await expect(responses).toContainText('0 confirmed · 1 tentative')
  await expect(responses).toContainText('Tentative:')

  await page.getByRole('button', { name: 'Raids', exact: true }).click()
  await raid.getByRole('button', { name: 'I’ll be there' }).click()
  await expect(raid.getByText('You confirmed you’ll be there.')).toBeVisible()
  await raid.getByRole('button', { name: 'I can’t make it' }).click()
  await raid.getByLabel(/What’s changed/).fill('Working late')
  await raid.getByRole('button', { name: 'Tell the officers' }).click()
  await expect(raid.getByText(/can’t make it: “Working late”/)).toBeVisible()

  // As the officer.
  await navigate(page, 'Raid planner')
  await page.getByRole('tab', { name: 'Responses' }).click()
  await expect(responses).toContainText('0 confirmed · 0 tentative')
  await expect(responses).toContainText('1 can’t make it')
  await expect(responses).toContainText('Working late')
  await responses.getByRole('button', { name: /Find a replacement for/ }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: /^Replace / })).toBeVisible()
})
