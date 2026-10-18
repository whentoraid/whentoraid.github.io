import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState } from '../lib/seed.js'

vi.mock('../lib/remote/sync.svelte.js', () => ({ remote: { guildId: 'g1', memberId: 'm0' } }))
vi.mock('../lib/record-flags.svelte.js', () => ({
  recordFlagsOnline: () => true,
  loadRecordFlags: vi.fn(),
  flagRecord: vi.fn(),
  recordFlags: { rows: [], error: '' },
}))

const flags = await import('../lib/record-flags.svelte.js')
const { default: RaidRecord } = await import('./RaidRecord.svelte')
const PREVIOUS = '2026-09-21'
const NOW = Date.parse('2026-09-28T12:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  const seed = createSeedState()
  app.data = {
    ...seed,
    weeks: {
      ...seed.weeks,
      [PREVIOUS]: {
        checkins: {},
        plans: {
          'raid-20': {
            start: Date.parse('2026-09-25T23:30:00Z'),
            team: [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }],
            attendance: { m0: 'noshow' },
          },
        },
      },
    },
  }
  flags.recordFlags.rows = []
})

const props = { memberId: 'm0', thisWeek: '2026-09-28', now: NOW }

test('a player reports a mistake without changing the record', async () => {
  flags.flagRecord.mockResolvedValue('f1')
  render(RaidRecord, props)
  expect(screen.getByText('No-show recorded')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: /Report a mistake for 20-player Raid/ }))
  await fireEvent.input(screen.getByLabelText('What looks wrong?'), { target: { value: ' I was there ' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Send to officers' }))
  expect(flags.flagRecord).toHaveBeenCalledWith(PREVIOUS, 'raid-20', 'I was there')
  expect(app.data.weeks[PREVIOUS].plans['raid-20'].attendance.m0).toBe('noshow')
})

test('an open report waits for officers and cannot be sent twice', () => {
  flags.recordFlags.rows = [
    { id: 'f1', week: PREVIOUS, raid_id: 'raid-20', member_id: 'm0', note: 'I was there', status: 'open' },
  ]
  render(RaidRecord, props)
  expect(screen.getByText(/Waiting for officers to review it/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Report a mistake for 20-player Raid/ })).toBeNull()
})

test('a reviewed report names the officer and shows their reply', () => {
  flags.recordFlags.rows = [
    {
      id: 'f1',
      week: PREVIOUS,
      raid_id: 'raid-20',
      member_id: 'm0',
      note: 'I was there',
      status: 'resolved',
      resolved_by: 'm1',
      reply: 'Changed to late.',
    },
  ]
  render(RaidRecord, props)
  const officer = app.data.members.find((m) => m.id === 'm1').name
  expect(screen.getByText(`${officer} reviewed your report: “Changed to late.”`)).toBeTruthy()
})
