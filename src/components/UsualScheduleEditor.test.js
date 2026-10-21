import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { display } from '../lib/display.svelte.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
import { getCheckin, saveAvailabilityTemplate } from '../lib/model.js'
import { slotWindow } from '../lib/grid.js'
import UsualScheduleEditor from './UsualScheduleEditor.svelte'

vi.mock('../lib/remote/sync.svelte.js', () => ({ canManage: () => false, remote: { guildId: 'g1' } }))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  app.data = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, 'm0')
  app.data.settings.checkinDeadline = null
  display.localTime = false
})
afterEach(() => {
  vi.useRealTimers()
  display.localTime = true
})
const open = () => render(UsualScheduleEditor, { open: true, memberId: 'm0', onclose: vi.fn() })
async function addMonday(week = SEED_WEEK) {
  const interval = slotWindow(week, 0, 0, 2, app.data.guild)
  await fireEvent.change(screen.getByLabelText('Mon from'), { target: { value: String(interval.start) } })
  await fireEvent.change(screen.getByLabelText('Mon until'), { target: { value: String(interval.end) } })
  await fireEvent.click(screen.getByRole('button', { name: 'Add times for Mon' }))
}
test('canceling a draft leaves both the template and current-week answers untouched', async () => {
  const before = app.data
  open()
  await addMonday()
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(app.data).toBe(before)
})
test('saving a usual schedule changes future inherited weeks without rewriting explicit weekly answers', async () => {
  const before = getCheckin(app.data, SEED_WEEK, 'm0')
  const slots = [...app.data.templates.m0.slots]
  open()
  await addMonday()
  await fireEvent.click(screen.getByRole('button', { name: 'Save usual schedule' }))
  expect(getCheckin(app.data, SEED_WEEK, 'm0')).toEqual(before)
  expect(app.data.templates.m0.slots).toEqual(expect.arrayContaining([...slots, 0, 1]))
})
test('a closed weekly deadline starts usual-schedule changes next week', async () => {
  app.data.settings.checkinDeadline = { day: 0, minutes: 0 }
  open()
  expect(screen.getByText(/Repeats from Oct 5/)).toBeTruthy()
  await addMonday('2026-10-05')
  await fireEvent.click(screen.getByRole('button', { name: 'Save usual schedule' }))
  expect(app.data.templates.m0.fromWeek).toBe('2026-10-05')
  expect(app.data.templates.m0.previous.fromWeek).toBe(SEED_WEEK)
})
test('background guild updates do not erase the open draft', async () => {
  open()
  await addMonday()
  app.data = { ...app.data, guild: { ...app.data.guild, name: 'Updated guild name' } }
  await fireEvent.click(screen.getByRole('button', { name: 'Save usual schedule' }))
  expect(app.data.templates.m0.slots).toEqual(expect.arrayContaining([0, 1]))
  expect(app.data.guild.name).toBe('Updated guild name')
})
