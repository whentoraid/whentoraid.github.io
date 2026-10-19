import { expect, test } from 'vitest'
import { signInError } from './auth-error.js'

test('a failed Discord sign-in returns an explanation and the address without the error', () => {
  const result = signInError(
    'https://whentoraid.github.io/?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+pc6H#/home/2026-10-19',
  )
  expect(result.message).toMatch(/Discord sign-in did not finish/)
  expect(result.message).toMatch(/Unable to exchange external code/)
  expect(result.cleanUrl).toBe('https://whentoraid.github.io/#/home/2026-10-19')
})

test('cancelling on Discord says so plainly', () => {
  const result = signInError('https://whentoraid.github.io/?error=access_denied&error_description=denied')
  expect(result.message).toMatch(/cancelled/)
})

test('an ordinary address has no sign-in error', () => {
  expect(signInError('https://whentoraid.github.io/?guild=x#/home')).toBeNull()
})
