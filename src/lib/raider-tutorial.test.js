import { beforeEach, expect, test, vi } from 'vitest'
import { createSeedState, SEED_WEEK } from './seed.js'
import { readTutorial, saveTutorial, tutorialWeek } from './raider-tutorial.js'
import { saveCharacter } from './model.js'

beforeEach(() => localStorage.clear())

test('tutorial progress is scoped to the guild and member, including pause and completion', () => {
  saveTutorial('guild-a:member-a', 'paused', 1)
  expect(readTutorial('guild-a:member-a')).toEqual({ status: 'paused', step: 1 })
  expect(readTutorial('guild-b:member-a').status).toBe('new')
  expect(readTutorial('guild-a:member-b').status).toBe('new')
  saveTutorial('guild-a:member-a', 'complete', 2)
  expect(readTutorial('guild-a:member-a')).toEqual({ status: 'complete', step: 2 })
})

test('unavailable or corrupt browser storage does not prevent the tutorial', () => {
  localStorage.setItem('whentoraid-raider-tutorial:bad', '{broken')
  expect(readTutorial('bad').status).toBe('new')
  localStorage.setItem('whentoraid-raider-tutorial:bad', JSON.stringify({ status: 'active', step: 99 }))
  expect(readTutorial('bad').step).toBe(0)
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Full')
  })
  try {
    expect(() => saveTutorial('scope', 'active', 0)).not.toThrow()
  } finally {
    write.mockRestore()
  }
})

test('a late join uses next week unless there is still an announced raid to answer', () => {
  const state = createSeedState()
  state.weeks = {}
  const now = Date.parse('2026-10-04T12:00:00Z')
  expect(tutorialWeek(state, now)).toBe('2026-10-05')
  const start = now + 3600000
  state.weeks[SEED_WEEK] = {
    checkins: {},
    plans: { 'raid-20': { published: { start, end: start + 3600000, team: [] } } },
  }
  expect(tutorialWeek(state, now)).toBe(SEED_WEEK)
  state.weeks[SEED_WEEK].plans['raid-20'].cancelled = true
  expect(tutorialWeek(state, now)).toBe('2026-10-05')
})

test('the first character becomes the main; adding an alt keeps the main', () => {
  const initial = createSeedState()
  initial.characters = initial.characters.filter((character) => character.memberId !== 'm0')
  const input = { name: 'Firstblade', realm: 'Whitemane', class: 'Warrior', spec: 'Arms', role: 'DPS' }
  const first = saveCharacter(initial, 'm0', input, () => 'first').state
  const second = saveCharacter(first, 'm0', { ...input, name: 'Altblade' }, () => 'second').state
  expect(second.characters.find((c) => c.id === 'first').main).toBe(true)
  expect(second.characters.find((c) => c.id === 'second').main).toBe(false)
})
