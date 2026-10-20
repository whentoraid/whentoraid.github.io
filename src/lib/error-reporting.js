import { parseHash } from './route.js'

/** One page load sends at most this many reports; a loop failing every frame stops there. */
export const MAX_REPORTS_PER_PAGE = 10

// Noise with nothing to act on: cross-origin scripts hide their message, and the resize warning is
// harmless browser chatter.
const IGNORED = [/^Script error\.?$/, /ResizeObserver loop/]

/** The message and stack of whatever was thrown or rejected. */
export function describeError(reason) {
  if (reason instanceof Error)
    return { message: `${reason.name}: ${reason.message}`, detail: reason.stack ?? null }
  if (typeof reason === 'string') return { message: reason, detail: null }
  try {
    return { message: JSON.stringify(reason) ?? String(reason), detail: null }
  } catch {
    return { message: String(reason), detail: null }
  }
}

/**
 * Report uncaught errors and unhandled promise rejections. Each report names only the page (never
 * the address, which can hold sign-in codes or invites), the message and the stack. Repeats of a
 * message are sent once. Sending never throws, so a broken connection cannot cause more reports.
 * @param {{ target?: EventTarget, send: (report: { message: string, detail: string | null,
 *   page: string, userAgent: string }) => Promise<void>, location?: { hash: string },
 *   userAgent?: string }} options
 * @returns {() => void} removes the listeners
 */
export function installErrorReporting({
  target = window,
  send,
  location = window.location,
  userAgent = navigator.userAgent,
}) {
  const seen = new Set()
  const report = (reason) => {
    const { message, detail } = describeError(reason)
    if (!message || IGNORED.some((pattern) => pattern.test(message))) return
    if (seen.has(message) || seen.size >= MAX_REPORTS_PER_PAGE) return
    seen.add(message)
    const page = parseHash(location.hash).view
    Promise.resolve()
      .then(() => send({ message, detail, page, userAgent }))
      .catch(() => {})
  }
  const onError = (event) => report(event.error ?? event.message)
  const onRejection = (event) => report(event.reason)
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}

/** Sends a report to the hosted database, but only for a signed-in player. */
export function supabaseErrorSender(supabase) {
  return async ({ message, detail, page, userAgent }) => {
    const { data } = await supabase.auth.getSession()
    if (!data?.session) return
    await supabase.rpc('report_app_error', {
      p_message: message,
      p_detail: detail,
      p_page: page,
      p_user_agent: userAgent,
    })
  }
}
