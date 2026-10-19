const AUTH_ERROR_PARAMS = ['error', 'error_code', 'error_description']

/**
 * A Discord sign-in that failed comes back with `?error=…&error_description=…` instead of a session.
 * Without saying so, the player lands on sign-in again and keeps retrying.
 * @param {string} href
 * @returns {{ message: string, cleanUrl: string } | null}
 */
export function signInError(href) {
  const url = new URL(href)
  const code = url.searchParams.get('error')
  if (!code) return null
  const detail = url.searchParams.get('error_description') ?? code
  for (const param of AUTH_ERROR_PARAMS) url.searchParams.delete(param)
  const message =
    code === 'access_denied'
      ? 'Discord sign-in was cancelled. Press Sign in with Discord and choose Authorize to continue.'
      : `Discord sign-in did not finish (${detail}). This is a problem on the WhenToRaid side, not your account: let your guild officer know, then try again later.`
  return { message, cleanUrl: url.toString() }
}
