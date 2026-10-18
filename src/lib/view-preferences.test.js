import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  availabilityPreferenceScope,
  readAvailabilityPreferences,
  saveAvailabilityPreference,
} from './view-preferences.js'

const defaults = { editor: 'grid', section: 'times' }
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('availability display preferences', () => {
  test('preferences are isolated by online guild and viewer, not the officer’s editing target', () => {
    const state = { guild: { name: 'Raiders' }, currentMemberId: 'm-other' }
    const remote = { guildId: 'g1', memberId: 'm-me' }
    const scope = availabilityPreferenceScope(state, remote)
    saveAvailabilityPreference(scope, 'editor', 'ranges')
    expect(
      readAvailabilityPreferences(
        availabilityPreferenceScope({ ...state, currentMemberId: 'm-third' }, remote),
        defaults,
      ).editor,
    ).toBe('ranges')
    expect(
      readAvailabilityPreferences(availabilityPreferenceScope(state, { ...remote, guildId: 'g2' }), defaults),
    ).toEqual(defaults)
    expect(
      readAvailabilityPreferences(
        availabilityPreferenceScope(state, { ...remote, memberId: 'm-other' }),
        defaults,
      ),
    ).toEqual(defaults)
  })

  test('only known display values are restored or saved', () => {
    localStorage.setItem(
      'whentoraid-availability-view:test',
      JSON.stringify({ editor: 'broken', section: 'characters', currentMemberId: 'someone-else' }),
    )
    expect(readAvailabilityPreferences('test', defaults)).toEqual({ editor: 'grid', section: 'characters' })
    saveAvailabilityPreference('test', 'currentMemberId', 'someone-else')
    saveAvailabilityPreference('test', 'editor', 'ranges')
    expect(JSON.parse(localStorage.getItem('whentoraid-availability-view:test'))).toEqual({
      editor: 'ranges',
      section: 'characters',
    })
  })

  test('corrupt or unavailable storage keeps the editor usable', () => {
    localStorage.setItem('whentoraid-availability-view:test', '{broken')
    expect(readAvailabilityPreferences('test', defaults)).toEqual(defaults)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Full')
    })
    expect(readAvailabilityPreferences('test', defaults)).toEqual(defaults)
    expect(() => saveAvailabilityPreference('test', 'editor', 'ranges')).not.toThrow()
  })
})
