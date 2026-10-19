import { expect, test } from 'vitest'
import { hasGuildLink } from './guild-link.js'

test('a Discord link names an online guild in the address', () => {
  expect(hasGuildLink('?guild=8777b118-d2dc-41e0-af0f-28b6ce78e647')).toBe(true)
  expect(hasGuildLink('?x=1&guild=8777b118-d2dc-41e0-af0f-28b6ce78e647')).toBe(true)
})

test('an ordinary address names no guild', () => {
  expect(hasGuildLink('')).toBe(false)
  expect(hasGuildLink('?guild=')).toBe(false)
  expect(hasGuildLink('?guild=not-a-guild')).toBe(false)
})
