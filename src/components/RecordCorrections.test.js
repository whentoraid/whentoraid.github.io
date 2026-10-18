import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'

vi.mock('../lib/record-flags.svelte.js', () => ({
  loadRecordFlags: vi.fn(),
  resolveFlag: vi.fn(),
  recordFlags: { rows: [], error: '' },
}))

const flags = await import('../lib/record-flags.svelte.js')
const { default: RecordCorrections } = await import('./RecordCorrections.svelte')
const report = {
  id: 'f1',
  week: SEED_WEEK,
  raid_id: 'raid-20',
  member_id: 'm1',
  note: 'I was there',
  status: 'open',
}

beforeEach(() => {
  vi.resetAllMocks()
  app.data = createSeedState()
  flags.recordFlags.rows = [report, { ...report, id: 'f0', status: 'resolved' }]
  flags.recordFlags.error = ''
})

test('officers see open reports and mark one reviewed with a reply', async () => {
  flags.resolveFlag.mockResolvedValue(null)
  render(RecordCorrections)
  expect(screen.getByRole('heading', { name: '1 player reported a mistake' })).toBeTruthy()
  expect(screen.getByText('“I was there”')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))
  await fireEvent.input(screen.getByLabelText(/Reply to/), { target: { value: ' Fixed to attended. ' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))
  expect(flags.resolveFlag).toHaveBeenCalledWith('f1', 'Fixed to attended.')
})

test('Open attendance takes the officer to that raid’s After the raid panel', async () => {
  app.view = 'home'
  render(RecordCorrections)
  await fireEvent.click(screen.getByRole('button', { name: 'Open attendance' }))
  expect(app.view).toBe('planner')
  expect(app.data.currentWeek).toBe(SEED_WEEK)
  expect(app.data.currentRaidId).toBe('raid-20')
  expect(app.plannerIntent).toEqual({ section: 'roster', focus: 'attendance' })
})

test('nothing is shown when no report is open', () => {
  flags.recordFlags.rows = [{ ...report, status: 'resolved' }]
  render(RecordCorrections)
  expect(screen.queryByRole('region', { name: 'Record corrections' })).toBeNull()
})
