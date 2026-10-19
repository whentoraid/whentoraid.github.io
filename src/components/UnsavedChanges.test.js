import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { changes: [], status: 'error' },
  discardUnsavedChange: vi.fn(),
  dismissUnsavedDraft: vi.fn(),
  downloadUnsavedDraft: vi.fn(),
  reapplyUnsavedDraft: vi.fn(),
}))

const sync = await import('../lib/remote/sync.svelte.js')
const { default: UnsavedChanges } = await import('./UnsavedChanges.svelte')

const availability = {
  id: 'checkins:g|2026-09-28|m0',
  task: 'availability',
  week: '2026-09-28',
  title: 'Your availability for the week of Sep 28',
  outcome: 'conflict',
  reason: 'Someone changed this online after you started. Saving yours replaces the online version.',
  differences: [{ label: 'Fri Oct 2', online: '7:00 pm – 10:00 pm', yours: '8:00 pm – 10:00 pm' }],
}
const closed = {
  ...availability,
  id: 'checkins:g|2026-09-21|m0',
  title: 'Your availability for the week of Sep 21',
  outcome: 'closed',
  reason: 'Check-ins for this week closed Wed, Sep 23, 6:00 PM PDT. Ask an officer to change it.',
}

beforeEach(() => {
  vi.resetAllMocks()
  sync.remote.changes = [availability, closed]
})

test('each unsaved change shows the online version beside the attempted one', () => {
  render(UnsavedChanges)
  expect(screen.getByText('2 changes were not saved online.')).toBeTruthy()
  const [row] = screen.getAllByRole('row', { name: /Fri Oct 2/ })
  expect(row.textContent).toContain('7:00 pm – 10:00 pm')
  expect(row.textContent).toContain('8:00 pm – 10:00 pm')
  expect(screen.getByText(/Ask an officer to change it/)).toBeTruthy()
})

test('only changes that still apply are saved again, after confirming a replacement', async () => {
  render(UnsavedChanges)
  await fireEvent.click(screen.getByRole('button', { name: 'Save this change again' }))
  expect(sync.reapplyUnsavedDraft).not.toHaveBeenCalled()
  await fireEvent.click(screen.getByRole('button', { name: /Replace the online version/ }))
  expect(sync.reapplyUnsavedDraft).toHaveBeenCalledOnce()
})

test('a single change can be discarded on its own', async () => {
  render(UnsavedChanges)
  await fireEvent.click(screen.getAllByRole('button', { name: 'Discard this change' })[1])
  expect(sync.discardUnsavedChange).toHaveBeenCalledWith(closed.id)
})
