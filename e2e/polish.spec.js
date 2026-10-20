import { expect, test } from '@playwright/test'
import { createSeedState, SEED_WEEK } from '../src/lib/seed.js'
import { plannerContext } from '../src/lib/planning.js'
import { publishPlan } from '../src/lib/raid-workflow.js'
import { navigate } from './helpers.js'

const NOW = new Date('2026-10-01T12:00:00Z')

function plannedGuild() {
  const state = createSeedState()
  state.settings.raids.find((raid) => raid.id === 'raid-20').name = 'Blackwing Lair'
  const { plan, players } = plannerContext(state)
  return publishPlan(state, plan, players, NOW.getTime()).state
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(
    (state) => localStorage.setItem('whentoraid-v3', JSON.stringify(state)),
    plannedGuild(),
  )
})

test('officer workload filters preserve issue actions and the return to the original raid', async ({
  page,
}) => {
  await page.goto('./#/officer')
  const dashboard = page.getByRole('region', { name: 'Officer dashboard', exact: true })
  await dashboard.getByRole('button', { name: /^Published/ }).click()
  await expect(dashboard.locator('.raid-row')).toHaveCount(1)
  await expect(dashboard.locator('.raid-row')).toContainText('Blackwing Lair')
  await dashboard.getByRole('button', { name: /^Needs attention/ }).click()
  await expect(dashboard.locator('.raid-row .published')).toHaveCount(0)
  const issue = dashboard.getByRole('button', { name: /^Choose a time: 10-player Raid 1/ }).first()
  await issue.click()
  await expect(page.getByRole('tab', { name: 'Schedule', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('10-player Raid 1')
  await page.getByRole('button', { name: 'Back to officer dashboard' }).click()
  const original = dashboard.locator(`[data-row="${SEED_WEEK}/raid-10-1"]`)
  await expect(original).toBeVisible()
  await expect(original.getByRole('button').first()).toBeFocused()
  await dashboard.getByRole('button', { name: /^Published/ }).click()
  await dashboard.getByRole('button', { name: /Check confirmations: Blackwing Lair/ }).click()
  await expect(page.getByRole('tab', { name: 'Responses', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('availability starts with readable days, remembers the paint editor, and keeps the primary shortcut', async ({
  page,
}) => {
  await page.goto('./#/home')
  await page.getByRole('button', { name: 'Edit my availability', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Time ranges', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('Edit Fri availability', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Preferred', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Preferred', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Paint grid', exact: true }).click()
  await navigate(page, 'My raids')
  await page.getByRole('button', { name: 'Edit my availability', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Paint grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('all four workspaces fit desktop and phone and show a clear selection', async ({
  page,
  isMobile,
}, testInfo) => {
  const viewport = isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }
  await page.setViewportSize(viewport)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const view of ['home', 'availability', 'officer', 'planner']) {
    await page.goto(`./#/${view}`)
    await page.locator('h1').waitFor()
    await page.mouse.click(1, 1)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    await page.screenshot({ path: testInfo.outputPath(`${view}.png`), fullPage: true })
    await page.screenshot({ path: testInfo.outputPath(`${view}-viewport.png`) })
  }
  const selected = page.getByRole('button', { name: /TOP SUGGESTION/ })
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /ALTERNATIVE 01/ }).click()
  await expect(selected).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: /ALTERNATIVE 01/ })).toHaveAttribute('aria-pressed', 'true')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await selected.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
  expect(errors).toEqual([])
})

test('all four workspaces handle long names at 320 pixels', async ({ page }, testInfo) => {
  const state = plannedGuild()
  state.guild.name = 'The Exceptionally Long Guild Name for a Very Busy Raid Team'
  state.settings.raids[0].name = 'The Exceptionally Long Name of Our Weekly Raid'
  state.characters[0].name = 'ExtraordinarilyLongCharacterName'
  await page.addInitScript((value) => localStorage.setItem('whentoraid-v3', JSON.stringify(value)), state)
  await page.setViewportSize({ width: 320, height: 780 })
  for (const view of ['home', 'availability', 'officer', 'planner']) {
    await page.goto(`./#/${view}`)
    await page.locator('h1').waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth), view).toBe(320)
    if (view === 'availability') {
      await page.getByLabel('Edit Fri availability', { exact: true }).click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    }
    await page.screenshot({ path: testInfo.outputPath(`320-${view}.png`), fullPage: true })
  }
})
