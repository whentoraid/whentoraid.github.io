import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { getCheckin, saveAvailabilityTemplate } from '../lib/model.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
import { addDays } from '../lib/time.js'
import UsualSchedule from './UsualSchedule.svelte'

const NEXT = addDays(SEED_WEEK, 7)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse('2026-09-28T12:00:00Z'))
  app.data = saveAvailabilityTemplate(createSeedState(), SEED_WEEK, 'm0')
})

afterEach(() => vi.useRealTimers())

const open = () => render(UsualSchedule, { memberId: 'm0', weekIso: SEED_WEEK })

test('taking a break warns about a published place, then counts the paused weeks as away', async () => {
  const start = Date.parse('2026-10-02T23:30:00Z')
  app.data.weeks[SEED_WEEK].plans['raid-20'] = {
    start,
    team: [],
    published: {
      start,
      end: start + 3 * 3600000,
      publishedAt: 1,
      team: [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }],
    },
  }
  open()
  const pause = screen.getByRole('region', { name: 'Take a break' })
  expect(within(pause).getByText(/You’re on the roster for 20-player Raid \(Sep 28\)/)).toBeTruthy()
  await fireEvent.change(within(pause).getByLabelText('Resume'), { target: { value: addDays(NEXT, 7) } })
  expect(within(pause).getByText(/2 weeks \(Sep 28 – Oct 11\) count as away/)).toBeTruthy()
  await fireEvent.click(within(pause).getByRole('button', { name: 'Take a break' }))
  expect(getCheckin(app.data, NEXT, 'm0')).toMatchObject({ checkedIn: true, ranges: [], paused: true })
  expect(within(pause).getByRole('status').textContent).toMatch(
    /Paused from the week of Sep 28 until the week of Oct 12/,
  )

  await fireEvent.click(within(pause).getByRole('button', { name: 'Resume from the week of Sep 28' }))
  expect(app.data.templates.m0.pausedFrom).toBeUndefined()
})

test('a last week can be set and cleared', async () => {
  open()
  const select = screen.getByLabelText('Last week it applies')
  await fireEvent.change(select, { target: { value: NEXT } })
  expect(app.data.templates.m0.endWeek).toBe(NEXT)
  await fireEvent.change(select, { target: { value: '' } })
  expect(app.data.templates.m0.endWeek).toBeUndefined()
})

test('the review interval and Still right are saved on the schedule', async () => {
  app.data.templates.m0 = { ...app.data.templates.m0, confirmedAt: '2026-07-01' }
  open()
  const review = screen.getByRole('region', { name: 'Review your usual schedule' })
  expect(within(review).getByText(/Is this still right\? Last confirmed Jul 1/)).toBeTruthy()
  await fireEvent.change(within(review).getByLabelText(/Ask me again every/), { target: { value: '12' } })
  expect(app.data.templates.m0.reviewWeeks).toBe(12)
  await fireEvent.click(within(review).getByRole('button', { name: 'Still right' }))
  expect(app.data.templates.m0.confirmedAt).toBe('2026-09-28')
})
