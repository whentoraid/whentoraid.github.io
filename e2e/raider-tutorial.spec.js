import { expect, test } from '@playwright/test'
import { createSeedState, SEED_WEEK } from '../src/lib/seed.js'
import { navigate } from './helpers.js'

async function seed(page, { scheduled = false, now = '2026-09-28T12:00:00Z' } = {}) {
  const state = createSeedState()
  state.characters = state.characters.filter((character) => character.memberId !== state.currentMemberId)
  state.weeks = {}
  if (scheduled) {
    state.settings.raids = [state.settings.raids.find((raid) => raid.id === 'raid-20')]
    state.settings.raids[0].series = {
      day: 4,
      minutes: 19 * 60,
      timezone: state.guild.timezone,
      startDate: SEED_WEEK,
      endDate: '2026-10-25',
    }
  }
  await page.clock.setFixedTime(new Date(now))
  await page.addInitScript((initial) => {
    if (!localStorage.getItem('whentoraid-v3')) localStorage.setItem('whentoraid-v3', JSON.stringify(initial))
  }, state)
  await page.goto('./#/home')
  await page.getByRole('button', { name: 'Start guided tutorial' }).click()
}

async function addCharacter(page) {
  const tutorial = page.getByRole('dialog', { name: 'Raider tutorial' })
  await tutorial.getByLabel('Character name', { exact: true }).fill('Firstblade')
  await tutorial.getByLabel('Realm', { exact: true }).fill('Whitemane')
  await tutorial.getByLabel('Specialization').selectOption('Arms')
  await tutorial.getByRole('button', { name: 'Save my character & continue' }).click()
  await expect(tutorial.getByRole('heading', { name: 'Give your first answer' })).toBeFocused()
  return tutorial
}

test('a new member signs up, resumes after reload and practices confirmation without sending it', async ({
  page,
}, testInfo) => {
  await seed(page, { scheduled: true })
  const tutorial = await addCharacter(page)
  await expect(tutorial.getByRole('button', { name: 'Continue to confirmation' })).toBeDisabled()
  await expect(tutorial.getByLabel('Spec for this raid')).toBeHidden()
  await tutorial.getByRole('button', { name: 'I’m in', exact: true }).click()
  await expect(tutorial.getByText('You’ve given availability.', { exact: true })).toBeVisible()
  await tutorial.getByRole('button', { name: 'Continue to confirmation' }).click()
  await page.reload()
  await expect(tutorial.getByRole('heading', { name: 'Try confirming your spot' })).toBeVisible()
  const before = await page.evaluate(() => localStorage.getItem('whentoraid-v3'))
  await expect(tutorial.getByRole('button', { name: 'Finish tutorial & view my raids' })).toBeDisabled()
  await tutorial.getByRole('button', { name: 'I’ll be there' }).click()
  expect(await page.evaluate(() => localStorage.getItem('whentoraid-v3'))).toBe(before)
  await page.screenshot({ path: testInfo.outputPath('tutorial-confirmation.png') })
  const widths = await tutorial.evaluate((element) => [element.scrollWidth, element.clientWidth])
  expect(widths[0]).toBeLessThanOrEqual(widths[1])
  await tutorial.getByRole('button', { name: 'Finish tutorial & view my raids' }).click()
  await expect(tutorial).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'My raids', exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('whentoraid-v3')))
  const character = saved.characters.find((c) => c.name === 'Firstblade')
  expect(character.main).toBe(true)
  expect(saved.weeks[SEED_WEEK].checkins[saved.currentMemberId].raids['raid-20'].signedAs.characterId).toBe(
    character.id,
  )
  await page.reload()
  await expect(tutorial).not.toBeVisible()
  await navigate(page, 'Raider tutorial')
  await expect(tutorial.getByRole('heading', { name: 'Add your raiding character' })).toBeVisible()
  await tutorial.getByRole('button', { name: 'Close', exact: true }).click()
})

test('pausing keeps a character and a late join can answer next week without a scheduled raid', async ({
  page,
}) => {
  await seed(page, { now: '2026-10-04T12:00:00Z' })
  const tutorial = await addCharacter(page)
  await expect(tutorial).toContainText('Oct 5')
  await tutorial.getByRole('button', { name: 'Finish later' }).click()
  await page.reload()
  await expect(tutorial).not.toBeVisible()
  await navigate(page, 'Raider tutorial')
  await expect(tutorial.getByRole('heading', { name: 'Give your first answer' })).toBeVisible()
  await tutorial.getByRole('button', { name: 'I’m unavailable for this week' }).click()
  await tutorial.getByRole('button', { name: 'Continue to confirmation' }).click()
  await expect(tutorial.getByRole('region', { name: 'Practice confirmation' })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('whentoraid-v3')))
  expect(saved.characters.filter((c) => c.memberId === saved.currentMemberId)).toHaveLength(1)
  expect(saved.weeks['2026-10-05'].checkins[saved.currentMemberId]).toMatchObject({
    checkedIn: true,
    ranges: [],
  })
})

test('without a scheduled raid, adding actual available times completes the answer step', async ({
  page,
}, testInfo) => {
  await seed(page)
  const tutorial = await addCharacter(page)
  await tutorial.getByLabel('Edit Mon availability', { exact: true }).click()
  await tutorial.getByRole('button', { name: 'Add times for Mon' }).click()
  await expect(tutorial.getByRole('button', { name: 'Continue to confirmation' })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('tutorial-availability.png') })
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('whentoraid-v3')))
  expect(saved.weeks[SEED_WEEK].checkins[saved.currentMemberId].ranges.length).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await expect(tutorial).not.toBeVisible()
})
