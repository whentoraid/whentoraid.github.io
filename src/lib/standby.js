import { charactersOf } from './model.js'

/** Standby and place offers: who is waiting for a place, and how long an offer stays open. */

const HOUR_MS = 3_600_000

/** Response deadlines officers can give an offer, in hours. */
export const OFFER_HOURS = [1, 3, 12, 24]
export const DEFAULT_OFFER_HOURS = 3

/** A player on standby can stop being reachable this many hours before the raid starts. */
export const STANDBY_UNTIL_HOURS = [1, 3]

/** An offer closes `hours` from now, but never after the raid starts. */
export const offerDeadline = (now, hours, raidStart) => Math.min(now + hours * HOUR_MS, raidStart)

const instant = (value) => (typeof value === 'number' ? value : Date.parse(value))

/** An open offer past its deadline reads as expired, even before the server is asked again. */
export const offerStatus = (offer, now) =>
  offer.status === 'open' && instant(offer.expires_at) <= now ? 'expired' : offer.status

/** "2 h 15 min left"; "expired" once the deadline passes. */
export function timeLeft(expiresAt, now) {
  const ms = instant(expiresAt) - now
  if (ms <= 0) return 'expired'
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes} min left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`
}

/** Standby rows for one raid that are still reachable at `now`. */
export const reachableStandby = (rows, raidId, now) =>
  (rows ?? []).filter(
    (row) => row.raid_id === raidId && (row.until_ms === null || Number(row.until_ms) > now),
  )

/** Choices for how long a player stays reachable: until the start, or a few hours before it. */
export function standbyUntilOptions(raidStart, now) {
  return [
    { label: 'Until the raid starts', value: null },
    ...STANDBY_UNTIL_HOURS.map((hours) => ({
      label: `Until ${hours} ${hours === 1 ? 'hour' : 'hours'} before it starts`,
      value: raidStart - hours * HOUR_MS,
    })),
  ].filter((option) => option.value === null || option.value > now)
}

/**
 * Who can be offered a place in `role`: active characters of that role whose player has no place in
 * the published roster. Standby players come first, with the character they chose first.
 */
export function offerCandidates(state, published, role, standbyRows) {
  const rostered = new Set(published.team.map((entry) => entry.memberId))
  const standby = new Map((standbyRows ?? []).map((row) => [row.member_id, row]))
  return state.members
    .filter((member) => !rostered.has(member.id))
    .flatMap((member) =>
      charactersOf(state, member.id)
        .filter((character) => character.role === role)
        .map((character) => ({
          member,
          character,
          standby: standby.has(member.id),
          chosen: standby.get(member.id)?.character_id === character.id,
        })),
    )
    .sort(
      (a, b) =>
        Number(b.standby) - Number(a.standby) ||
        Number(b.chosen) - Number(a.chosen) ||
        a.member.name.localeCompare(b.member.name) ||
        a.character.name.localeCompare(b.character.name),
    )
}
