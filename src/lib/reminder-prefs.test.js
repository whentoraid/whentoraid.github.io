import { describe, expect, test } from 'vitest'
import { minutesToTime, reminderPrefsSummary, timeToMinutes } from './reminder-prefs.js'

describe('quiet hour times', () => {
  test('read a time input and write it back', () => {
    expect(timeToMinutes('22:30')).toBe(1350)
    expect(timeToMinutes('00:00')).toBe(0)
    expect(minutesToTime(1350)).toBe('22:30')
    expect(minutesToTime(65)).toBe('01:05')
  })

  test('an empty or impossible time is not a time', () => {
    for (const value of ['', null, '24:00', '7:00', '12:60']) expect(timeToMinutes(value)).toBeNull()
  })
})

test('the summary says whether reminders ping and when they stay quiet', () => {
  expect(reminderPrefsSummary({ ping: true, quiet_start: null, quiet_end: null })).toBe('Pings on')
  expect(reminderPrefsSummary({ ping: true, quiet_start: 1320, quiet_end: 480 })).toBe(
    'Pings on · quiet 10:00 pm–8:00 am',
  )
  expect(reminderPrefsSummary({ ping: false, quiet_start: 1320, quiet_end: 480 })).toBe(
    'Named without a ping',
  )
})
