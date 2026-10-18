import { describe, expect, test } from 'vitest'
import { briefingFor, isRaidDay, meetUpTime, safeVoiceLink } from './raid-briefing.js'

const data = {
  raids: { 'raid-20': { assemblyMinutes: 15, location: 'Stormwind gates', contact: '', notes: 'Flasks' } },
  notes: [{ week: '2026-10-19', raidId: 'raid-20', note: 'Late pull' }],
}

describe('a raid’s briefing', () => {
  test('combines the raid profile with that week’s note and drops empty fields', () => {
    expect(briefingFor(data, '2026-10-19', 'raid-20')).toEqual({
      assemblyMinutes: 15,
      location: 'Stormwind gates',
      notes: 'Flasks',
      weekNote: 'Late pull',
    })
    expect(briefingFor(data, '2026-10-26', 'raid-20')).not.toHaveProperty('weekNote')
  })

  test('is null when the guild set nothing', () => {
    expect(briefingFor(data, '2026-10-19', 'raid-10')).toBeNull()
    expect(briefingFor(undefined, '2026-10-19', 'raid-20')).toBeNull()
  })

  test('gives the meet-up time in the viewer’s zone', () => {
    const start = Date.UTC(2026, 9, 20, 0, 0) // 8:00 pm in New York
    expect(meetUpTime(start, 15, 'America/New_York')).toBe('7:45 pm')
    expect(meetUpTime(start, 0, 'America/New_York')).toBeNull()
    expect(meetUpTime(start, undefined, 'America/New_York')).toBeNull()
  })

  test('counts as raid day from 12 hours before the start until the end', () => {
    const session = { start: 100 * 3600000, end: 103 * 3600000 }
    expect(isRaidDay(session, 87 * 3600000)).toBe(false)
    expect(isRaidDay(session, 88 * 3600000)).toBe(true)
    expect(isRaidDay(session, 103 * 3600000)).toBe(false)
  })
})

describe('voice links', () => {
  test('keep https links and name the host they open', () => {
    expect(safeVoiceLink(' https://www.discord.com/channels/1/2 ')).toEqual({
      href: 'https://www.discord.com/channels/1/2',
      host: 'discord.com',
    })
  })

  test('refuse other schemes and characters that break markup', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://discord.gg/x',
      'https://x.test/a b',
      'https://x.test/"',
      '',
    ])
      expect(safeVoiceLink(url)).toBeNull()
  })
})
