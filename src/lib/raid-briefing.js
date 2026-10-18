import { formatClock, wallTime } from './time.js'

export { safeVoiceLink } from '../../supabase/functions/_shared/raid-briefing.js'

/**
 * M15: a raid profile's optional raid-day logistics plus one week's note, as officers wrote them.
 * Limits match 20261101120000_raid_briefings.sql.
 */
export const BRIEFING_LIMITS = { location: 120, contact: 80, notes: 500, weekNote: 300, assemblyMinutes: 120 }

/** The raid-day view opens this long before the start. */
export const RAID_DAY_HOURS = 12

/**
 * @typedef {{ assemblyMinutes?: number, location?: string, voiceUrl?: string, contact?: string,
 *   notes?: string, weekNote?: string }} Briefing
 * @typedef {{ raids: Record<string, Briefing>, notes: { week: string, raidId: string, note: string }[] }} Briefings
 */

/**
 * One raid's briefing for one week, with empty fields left out; null when nothing is set.
 * @param {Briefings | null | undefined} briefings
 * @returns {Briefing | null}
 */
export function briefingFor(briefings, weekIso, raidId) {
  const standing = briefings?.raids?.[raidId] ?? {}
  const weekNote = briefings?.notes?.find((n) => n.week === weekIso && n.raidId === raidId)?.note
  const merged = Object.fromEntries(
    Object.entries({ ...standing, weekNote }).filter(([, value]) => value !== '' && value != null),
  )
  return Object.keys(merged).length ? merged : null
}

/** "7:45 pm" in `zone`: when to be in place, or null without a lead time. */
export function meetUpTime(start, assemblyMinutes, zone) {
  const minutes = Number(assemblyMinutes)
  if (!Number.isInteger(minutes) || minutes <= 0) return null
  return formatClock(wallTime(start - minutes * 60000, zone).minutes)
}

/** From RAID_DAY_HOURS before the start until the raid ends. */
export const isRaidDay = (session, now) =>
  now >= session.start - RAID_DAY_HOURS * 3600000 && now < session.end
