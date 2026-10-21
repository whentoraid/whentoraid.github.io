import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/lib/seed.js'
import { navigate } from './helpers.js'

test('a member adds their first character, gives availability, and returns to their saved editor', async ({
  page,
}) => {
  const state = createSeedState()
  state.characters = state.characters.filter((character) => character.memberId !== state.currentMemberId)
  state.weeks = {}
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00Z'))
  await page.addInitScript((initial) => {
    if (!localStorage.getItem('whentoraid-v3')) localStorage.setItem('whentoraid-v3', JSON.stringify(initial))
  }, state)
  await page.goto('./#/characters')
  const first = page.getByRole('button', { name: 'Add my first character' })
  await first.click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(first).toBeFocused()
  await first.click()
  await page.getByLabel('Character name', { exact: true }).fill('Firstblade')
  await page.getByLabel('Realm', { exact: true }).fill('Whitemane')
  await page.getByRole('combobox', { name: 'Specialization' }).selectOption('Arms')
  await page.getByRole('button', { name: 'Save character' }).click()
  await page.getByRole('button', { name: 'Continue to availability' }).click()
  await expect(page.getByRole('heading', { name: 'When can you raid?' })).toBeVisible()
  await expect(page.getByText('Saved in this browser', { exact: true }).last()).toBeInViewport()
  await page.getByText('Editing options', { exact: true }).click()
  await page.getByRole('button', { name: 'Time ranges', exact: true }).click()
  await page.getByRole('button', { name: 'Can’t make it this week' }).click()
  await expect(page.getByText('Checked in · not available this week', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss notification' }).click()
  await navigate(page, 'My characters')
  await page.getByRole('button', { name: '+ Add character' }).click()
  await expect(page.getByLabel('Realm', { exact: true })).toHaveValue('Whitemane')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await navigate(page, 'My availability')
  await page.getByText('Editing options', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Time ranges', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.reload()
  await page.getByText('Editing options', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Time ranges', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('Checked in · not available this week', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Account & guilds', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Account & guilds' })).toBeVisible()
})
