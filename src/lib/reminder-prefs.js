import { formatClock } from './time.js'

/** A player's Discord reminder pings and quiet hours (M06), as the server stores them. */

/** "22:30" from a time input as minutes after midnight, or null when empty or malformed. */
export function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '')
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : null
}

/** Minutes after midnight as a time input's "HH:MM". */
export const minutesToTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** One line for the collapsed panel, e.g. "Pings on · quiet 10:00 pm–8:00 am". */
export function reminderPrefsSummary({ ping, quiet_start: start, quiet_end: end }) {
  if (!ping) return 'Named without a ping'
  if (start === null || start === undefined) return 'Pings on'
  return `Pings on · quiet ${formatClock(start)}–${formatClock(end)}`
}
