import { afterEach, expect, test, vi } from 'vitest'
import { serverErrorReporter } from '../../supabase/functions/_shared/report-error.js'

afterEach(() => vi.restoreAllMocks())

test('an Edge Function failure is logged and recorded under the function name', async () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  const rpc = vi.fn(async () => ({ error: null }))
  const pending = []
  const log = serverErrorReporter({ rpc }, 'raid-dispatch', { waitUntil: (work) => pending.push(work) })

  log(`delivery 1 failed: ${'x'.repeat(600)}`)
  await Promise.all(pending)

  expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/^raid-dispatch: delivery 1 failed/))
  expect(rpc).toHaveBeenCalledWith('report_server_error', {
    p_source: 'raid-dispatch',
    p_message: expect.any(String),
  })
  expect(rpc.mock.calls[0][1].p_message).toHaveLength(500)
})

test('a failure to record is swallowed', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const pending = []
  const rpc = vi.fn(() => {
    throw new Error('database down')
  })
  const log = serverErrorReporter({ rpc }, 'raid-calendar', { waitUntil: (work) => pending.push(work) })

  expect(() => log('read failed')).not.toThrow()
  await expect(Promise.all(pending)).resolves.toBeDefined()
})
