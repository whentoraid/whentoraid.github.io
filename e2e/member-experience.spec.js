import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/lib/seed.js'
import { navigate } from './helpers.js'

test.use({ timezoneId: 'America/New_York' })
test.beforeEach(async ({ page }) => {
  const state = createSeedState()
  state.settings.raids = [state.settings.raids.find((raid) => raid.id === 'raid-20')]
  state.settings.raids[0].series = {
    day: 4,
    minutes: 19 * 60,
    timezone: state.guild.timezone,
    startDate: '2026-09-28',
    endDate: '2026-10-25',
  }
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'))
  await page.addInitScript((initial) => {
    if (!localStorage.getItem('whentoraid-v3')) localStorage.setItem('whentoraid-v3', JSON.stringify(initial))
  }, state)
})

test('an unassigned member can answer Late with a raid spec after the weekly deadline and reload it', async ({
  page,
}) => {
  await page.goto('./#/home')
  const quick = page.getByRole('region', { name: 'Answer this week’s raids' })
  await expect(quick.getByRole('button', { name: 'Late', exact: true })).toBeInViewport()
  await quick.getByLabel('Spec for this raid').selectOption('Arms|DPS')
  await quick.getByRole('button', { name: 'Late', exact: true }).click()
  await expect(quick.getByRole('button', { name: 'Late', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.reload()
  await expect(quick.getByRole('button', { name: 'Late', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(quick.getByLabel('Spec for this raid')).toHaveValue('Arms|DPS')
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('whentoraid-v3')))
  expect(data.characters.find((character) => character.id === 'c0a').spec).toBe('Protection')
})

test('timezone choice controls day dates and the Home raid label, and feedback is reachable', async ({
  page,
}) => {
  await page.goto('./#/availability')
  const times = page.locator('.time-details > summary')
  await expect(times).toHaveText('Times in America/New York')
  await times.click()
  await page.getByRole('checkbox', { name: /Use my timezone/ }).uncheck()
  await expect(times).toHaveText('Times in America/Los Angeles')
  await navigate(page, 'My raids')
  const quick = page.getByRole('region', { name: 'Answer this week’s raids' })
  await expect(quick.locator('.raid-time')).toContainText('PDT')
  const feedback = page.getByRole('button', { name: 'Something confusing? Send feedback' })
  if (!(await feedback.isVisible())) await page.getByRole('button', { name: 'More', exact: true }).click()
  await feedback.click()
  const dialog = page.getByRole('dialog', { name: 'Something confusing?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill('The raid time was unclear.')
  await expect(dialog.getByRole('button', { name: 'Download feedback' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
  expect(size[0]).toBeLessThanOrEqual(size[1])
})
