import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/client.js', () => ({ supabase: {} }))
vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { guildId: 'g1' },
  canManage: () => false,
  flushOnlineChanges: vi.fn(async () => {}),
  refreshOnlineGuild: vi.fn(),
}))
vi.mock('../lib/raid-services.js', () => ({
  listRaidSignups: vi.fn(),
  saveRaidAnswer: vi.fn(),
  undoRaidAnswer: vi.fn(),
}))
const services = await import('../lib/raid-services.js')
const sync = await import('../lib/remote/sync.svelte.js')
const { app } = await import('../lib/app.svelte.js')
const { createSeedState, SEED_WEEK } = await import('../lib/seed.js')
const { toast } = await import('../lib/toast.svelte.js')
const { default: RaidQuickAnswer } = await import('./RaidQuickAnswer.svelte')
const NOW = Date.parse('2026-09-28T12:00:00Z')
const row = (status = 'late') => ({
  raid_id: 'raid-20',
  member_id: 'm0',
  character_id: 'c0a',
  spec: 'Arms',
  role: 'DPS',
  status,
})
const group = () => screen.getByRole('group', { name: /Your answer for/ })
const button = (name) => within(group()).getByRole('button', { name })
async function open() {
  const component = render(RaidQuickAnswer, { memberId: 'm0', weekIso: SEED_WEEK, now: NOW })
  await vi.waitFor(() => expect(button('Late').disabled).toBe(false))
  return component
}
beforeEach(() => {
  vi.resetAllMocks()
  sync.remote.guildId = 'g1'
  services.listRaidSignups.mockResolvedValue([])
  services.saveRaidAnswer.mockImplementation(async (_client, _guild, args) => ({
    signup: row(args.status),
    undoId: args.requestId,
  }))
  services.undoRaidAnswer.mockResolvedValue({ signup: null })
  app.data = createSeedState()
  const start = Date.parse('2026-10-02T23:30:00Z')
  app.data.weeks[SEED_WEEK].plans['raid-20'] = {
    start,
    team: [],
    published: { start, end: start + 3 * 3600000, publishedAt: 1, team: [] },
  }
  delete app.data.weeks[SEED_WEEK].checkins.m0
})

test('one atomic save carries Late and a per-raid spec without optimistic checkin mutation', async () => {
  await open()
  const before = app.data
  await fireEvent.change(screen.getByLabelText('Spec for this raid'), { target: { value: 'Arms|DPS' } })
  await fireEvent.click(button('Late'))
  await vi.waitFor(() => expect(button('Late').getAttribute('aria-pressed')).toBe('true'))
  expect(services.saveRaidAnswer).toHaveBeenCalledWith(
    {},
    'g1',
    expect.objectContaining({
      weekIso: SEED_WEEK,
      raidId: 'raid-20',
      memberId: 'm0',
      status: 'late',
      characterId: 'c0a',
      spec: 'Arms',
      role: 'DPS',
      requestId: expect.any(String),
    }),
  )
  expect(sync.flushOnlineChanges).toHaveBeenCalledOnce()
  expect(sync.refreshOnlineGuild).toHaveBeenCalledOnce()
  expect(app.data).toBe(before)
  expect(screen.getByText(/Your answer: Signed up · arriving late/)).toBeTruthy()
})

test('answers saved through Discord display their canonical state and spec', async () => {
  services.listRaidSignups.mockResolvedValue([row(), { ...row('absent'), member_id: 'm1' }])
  await open()
  expect(button('Late').getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('Spec for this raid').value).toBe('Arms|DPS')
})

test('a lost response keeps the same request ID and arguments on retry', async () => {
  services.saveRaidAnswer.mockRejectedValueOnce(new Error('Connection interrupted'))
  await open()
  const before = app.data
  await fireEvent.click(button('Tentative'))
  await screen.findByRole('alert')
  expect(app.data).toBe(before)
  expect(screen.queryByText('Saved · shared with your guild')).toBeNull()
  const first = services.saveRaidAnswer.mock.calls[0][2]
  await fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
  await vi.waitFor(() => expect(button('Tentative').getAttribute('aria-pressed')).toBe('true'))
  expect(services.saveRaidAnswer.mock.calls[1][2]).toEqual(first)
})

test('Undo uses the server snapshot and refreshes the guild', async () => {
  await open()
  await fireEvent.click(button('Can’t make it'))
  await vi.waitFor(() => expect(toast.action?.label).toBe('Undo'))
  toast.action.run()
  await vi.waitFor(() =>
    expect(services.undoRaidAnswer).toHaveBeenCalledWith(
      {},
      services.saveRaidAnswer.mock.calls[0][2].requestId,
    ),
  )
  await vi.waitFor(() => expect(button('Can’t make it').getAttribute('aria-pressed')).toBe('false'))
})

test('an old background read cannot replace a just-saved answer', async () => {
  await open()
  let finishRead
  services.listRaidSignups.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve
      }),
  )
  app.data = {
    ...app.data,
    weeks: { ...app.data.weeks, [SEED_WEEK]: { ...app.data.weeks[SEED_WEEK], checkins: {} } },
  }
  await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
  await fireEvent.click(button('Late'))
  await vi.waitFor(() => expect(button('Late').getAttribute('aria-pressed')).toBe('true'))
  finishRead([row('absent')])
  await Promise.resolve()
  expect(button('Late').getAttribute('aria-pressed')).toBe('true')
})

test('weekly deadline does not close an upcoming raid answer', async () => {
  app.data.settings.checkinDeadline = { day: 0, minutes: 0 }
  await open()
  expect(button('I’m in').disabled).toBe(false)
})

test('failure to flush other edits prevents an answer from racing those edits', async () => {
  sync.flushOnlineChanges.mockRejectedValueOnce(new Error('Resolve your unsaved changes first'))
  await open()
  await fireEvent.click(button('I’m in'))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('Resolve your unsaved changes'),
  )
  expect(services.saveRaidAnswer).not.toHaveBeenCalled()
})
