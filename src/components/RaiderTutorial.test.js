import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { guildId: null, status: 'saved', hasUnsavedDraft: false },
  canManage: () => true,
  flushOnlineChanges: vi.fn(async () => {}),
  refreshOnlineGuild: vi.fn(),
}))
const { app } = await import('../lib/app.svelte.js')
const { flushOnlineChanges } = await import('../lib/remote/sync.svelte.js')
const { localSave } = await import('../lib/save-status.svelte.js')
const { createSeedState, SEED_WEEK } = await import('../lib/seed.js')
const { getCheckin } = await import('../lib/model.js')
const { readTutorial } = await import('../lib/raider-tutorial.js')
const { default: RaiderTutorial } = await import('./RaiderTutorial.svelte')
const scope = 'test-member'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  app.data = createSeedState()
  app.data.weeks = {}
  app.data.characters = app.data.characters.filter((c) => c.memberId !== 'm0')
  app.tutorialRequested = true
  app.view = 'characters'
  localSave.status = 'saved'
  flushOnlineChanges.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

async function character() {
  await fireEvent.input(screen.getByLabelText('Character name'), { target: { value: 'Firstblade' } })
  await fireEvent.input(screen.getByLabelText('Realm'), { target: { value: 'Whitemane' } })
  await fireEvent.change(screen.getByLabelText('Specialization'), { target: { value: 'Arms' } })
  await fireEvent.submit(screen.getByRole('button', { name: 'Save my character & continue' }).closest('form'))
}

test('real setup requires an answer, then practice confirms without changing any raid data', async () => {
  render(RaiderTutorial, { scope })
  await character()
  await screen.findByRole('heading', { name: 'Give your first answer' })
  expect(screen.getByRole('button', { name: 'Continue to confirmation' }).disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: 'I’m unavailable for this week' }))
  expect(getCheckin(app.data, SEED_WEEK, 'm0').checkedIn).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }))
  const practice = await screen.findByRole('region', { name: 'Practice confirmation' })
  const before = JSON.stringify(app.data)
  expect(screen.getByRole('button', { name: 'Finish tutorial & view Raids' }).disabled).toBe(false)
  await fireEvent.click(within(practice).getByRole('button', { name: 'I’ll be there' }))
  expect(JSON.stringify(app.data)).toBe(before)
  await fireEvent.click(screen.getByRole('button', { name: 'Finish tutorial & view Raids' }))
  expect(app.view).toBe('home')
  expect(readTutorial(scope)).toEqual({ status: 'complete', step: 2 })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('practice is optional and skipping it still completes setup without changing raid data', async () => {
  render(RaiderTutorial, { scope })
  await character()
  await screen.findByRole('heading', { name: 'Give your first answer' })
  await fireEvent.click(screen.getByRole('button', { name: 'I’m unavailable for this week' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }))
  await screen.findByRole('region', { name: 'Practice confirmation' })
  const before = JSON.stringify(app.data)
  await fireEvent.click(screen.getByRole('button', { name: 'Finish tutorial & view Raids' }))
  expect(app.view).toBe('home')
  expect(JSON.stringify(app.data)).toBe(before)
  expect(readTutorial(scope)).toEqual({ status: 'complete', step: 2 })
})

test('a failed save stays on the character step and can be retried without making duplicates', async () => {
  flushOnlineChanges.mockRejectedValueOnce(new Error('Connection interrupted'))
  render(RaiderTutorial, { scope })
  await character()
  expect((await screen.findByRole('alert')).textContent).toBe('Connection interrupted')
  expect(screen.getByRole('heading', { name: 'Add your raiding character' })).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Continue to my answer' }))
  await screen.findByRole('heading', { name: 'Give your first answer' })
  expect(app.data.characters.filter((c) => c.memberId === 'm0')).toHaveLength(1)
})

test('pausing keeps the saved character and resumes at availability after a remount', async () => {
  const first = render(RaiderTutorial, { scope })
  await character()
  await screen.findByRole('heading', { name: 'Give your first answer' })
  await fireEvent.click(screen.getByRole('button', { name: 'Finish later' }))
  expect(readTutorial(scope)).toEqual({ status: 'paused', step: 1 })
  first.unmount()
  render(RaiderTutorial, { scope })
  expect(screen.queryByRole('dialog')).toBeNull()
  app.tutorialRequested = true
  await screen.findByRole('heading', { name: 'Give your first answer' })
  expect(screen.queryByLabelText('Character name')).toBeNull()
})

test('a new guild scope does not inherit an active tutorial', async () => {
  const first = render(RaiderTutorial, { scope })
  await character()
  await screen.findByRole('heading', { name: 'Give your first answer' })
  first.unmount()
  render(RaiderTutorial, { scope: 'another-guild' })
  expect(screen.queryByRole('dialog')).toBeNull()
})
