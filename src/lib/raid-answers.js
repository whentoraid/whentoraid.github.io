import { SLOT_MINUTES } from './constants.js'
import { own } from './ids.js'
import { covers } from './intervals.js'
import {
  charactersOf,
  getCheckin,
  getWeek,
  setAvailabilityKind,
  setCharacterOffered,
  setRaidParticipation,
} from './model.js'
import { seriesOccurrences } from './raid-series.js'

/**
 * Answering one raid directly, like the Discord sign-up buttons: the raid's time becomes firm or
 * tentative availability and the player's participation in that raid is set. Other raids and other
 * times in the week are left as they were.
 */

const MS_PER_SLOT = SLOT_MINUTES * 60_000

/**
 * Raids with a time players may know for the week: a published roster, otherwise the recurring
 * schedule. An officer's unpublished draft time stays private.
 * @returns {{ raid: object, start: number, end: number }[]}
 */
export function announcedRaids(state, weekIso) {
  const plans = getWeek(state, weekIso).plans
  return state.settings.raids
    .flatMap((raid) => {
      const plan = own(plans, raid.id)
      if (plan?.cancelled) return []
      const length = raid.durationSlots * MS_PER_SLOT
      if (plan?.published) {
        const { start, end } = plan.published
        return [{ raid, start, end: end ?? start + length }]
      }
      const occurrence = raid.series && seriesOccurrences(raid.series).find((o) => o.weekIso === weekIso)
      if (!occurrence || occurrence.cancelled || occurrence.start === null) return []
      return [{ raid, start: occurrence.start, end: occurrence.start + length }]
    })
    .sort((a, b) => a.start - b.start)
}

/** @returns {'in' | 'tentative' | 'out' | null} the player's current answer for one announced raid */
export function raidAnswer(state, weekIso, memberId, { raid, start, end }) {
  const checkin = getCheckin(state, weekIso, memberId)
  if (!checkin.checkedIn) return null
  if (checkin.raids?.[raid.id]?.participating === false) return 'out'
  if (covers(checkin.ranges, { start, end })) return 'in'
  if (covers(checkin.tentativeRanges ?? [], { start, end })) return 'tentative'
  return null
}

/**
 * Answer one announced raid. "in" and "tentative" mark the raid's time and opt in; with
 * `characterId`, only that character is offered for this raid. "out" opts out of this raid only.
 * @param {'in' | 'tentative' | 'out'} answer
 */
export function answerRaid(state, weekIso, memberId, { raid, start, end }, answer, characterId = null) {
  if (answer === 'out') return setRaidParticipation(state, weekIso, memberId, raid.id, false)
  const kind = answer === 'in' ? 'firm' : 'tentative'
  let next = setAvailabilityKind(state, weekIso, memberId, { start, end }, kind, true)
  next = setRaidParticipation(next, weekIso, memberId, raid.id, true)
  if (!characterId) return next
  return charactersOf(next, memberId).reduce(
    (current, character) =>
      setCharacterOffered(current, weekIso, memberId, character.id, character.id === characterId, raid.id),
    next,
  )
}
