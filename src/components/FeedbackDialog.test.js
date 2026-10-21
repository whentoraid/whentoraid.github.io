import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, expect, test, vi } from 'vitest'
vi.mock('../lib/remote/client.js', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('../lib/remote/sync.svelte.js', () => ({ remote: { guildId: 'g1', officer: true } }))
const { supabase } = await import('../lib/remote/client.js')
const { app } = await import('../lib/app.svelte.js')
const { default: FeedbackDialog } = await import('./FeedbackDialog.svelte')
beforeEach(() => {
  vi.resetAllMocks()
  app.view = 'availability'
})
test('failed feedback keeps the message and retries with the same ID and minimal context', async () => {
  supabase.rpc.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ data: 'ok' })
  render(FeedbackDialog, { open: true, onclose: vi.fn() })
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Which timezone am I using?' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('Your message is kept'),
  )
  const request = supabase.rpc.mock.calls[0][1]
  expect(Object.keys(request).sort()).toEqual([
    'p_guild_id',
    'p_height',
    'p_id',
    'p_message',
    'p_page',
    'p_width',
  ])
  expect(request.p_page).toBe('availability')
  await fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  expect(supabase.rpc.mock.calls[1][1]).toEqual(request)
  expect(await screen.findByRole('status')).toHaveProperty(
    'textContent',
    expect.stringContaining('guild officers'),
  )
})
test('officer report loading surfaces rejected network requests with a retry', async () => {
  supabase.rpc.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ data: [] })
  render(FeedbackDialog, { open: true, onclose: vi.fn() })
  await fireEvent.click(screen.getByText('Recent guild feedback'))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Offline')
  await fireEvent.click(screen.getByRole('button', { name: 'Retry feedback' }))
  expect(await screen.findByText('No feedback yet.')).toBeTruthy()
})
