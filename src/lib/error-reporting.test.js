import { describe, expect, test, vi } from 'vitest'
import {
  MAX_REPORTS_PER_PAGE,
  describeError,
  installErrorReporting,
  supabaseErrorSender,
} from './error-reporting.js'

function setup(hash = '#/planner/2026-10-19') {
  const target = new EventTarget()
  const send = vi.fn(async () => {})
  const remove = installErrorReporting({ target, send, location: { hash }, userAgent: 'Test' })
  const fail = (error) => target.dispatchEvent(Object.assign(new Event('error'), { error }))
  const reject = (reason) => target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }))
  return { send, remove, fail, reject }
}

const settle = () => new Promise((resolve) => setTimeout(resolve))

describe('installErrorReporting', () => {
  test('reports an uncaught error with only the page name, never the address', async () => {
    const { send, fail } = setup('#/planner/2026-10-19?code=secret')
    fail(new TypeError('x is undefined'))
    await settle()
    expect(send).toHaveBeenCalledWith({
      message: 'TypeError: x is undefined',
      detail: expect.stringContaining('TypeError'),
      page: 'planner',
      userAgent: 'Test',
    })
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret')
  })

  test('reports unhandled promise rejections', async () => {
    const { send, reject } = setup()
    reject('save failed')
    await settle()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ message: 'save failed', detail: null }))
  })

  test('sends a repeated message once', async () => {
    const { send, fail } = setup()
    fail(new Error('same'))
    fail(new Error('same'))
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('stops after the per-page limit', async () => {
    const { send, fail } = setup()
    for (let i = 0; i < MAX_REPORTS_PER_PAGE + 5; i += 1) fail(new Error(`error ${i}`))
    await settle()
    expect(send).toHaveBeenCalledTimes(MAX_REPORTS_PER_PAGE)
  })

  test('ignores cross-origin and resize noise', async () => {
    const { send, fail } = setup()
    fail('Script error.')
    fail('ResizeObserver loop completed with undelivered notifications.')
    await settle()
    expect(send).not.toHaveBeenCalled()
  })

  test('a failed send is swallowed', async () => {
    const target = new EventTarget()
    const send = vi.fn(async () => {
      throw new Error('offline')
    })
    installErrorReporting({ target, send, location: { hash: '' }, userAgent: 'Test' })
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom') }))
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('removing the reporter stops reports', async () => {
    const { send, remove, fail } = setup()
    remove()
    fail(new Error('after'))
    await settle()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('describeError', () => {
  test('describes objects that are not errors', () => {
    expect(describeError({ code: 42 })).toEqual({ message: '{"code":42}', detail: null })
  })
})

describe('supabaseErrorSender', () => {
  test('sends only for a signed-in player', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const signedOut = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc }
    await supabaseErrorSender(signedOut)({ message: 'm', detail: null, page: 'home', userAgent: 'UA' })
    expect(rpc).not.toHaveBeenCalled()

    const signedIn = { auth: { getSession: async () => ({ data: { session: {} } }) }, rpc }
    await supabaseErrorSender(signedIn)({ message: 'm', detail: 'd', page: 'home', userAgent: 'UA' })
    expect(rpc).toHaveBeenCalledWith('report_app_error', {
      p_message: 'm',
      p_detail: 'd',
      p_page: 'home',
      p_user_agent: 'UA',
    })
  })
})
