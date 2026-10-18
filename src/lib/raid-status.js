import { templateFor } from './availability-template.js'
import { own } from './ids.js'
import { getCheckin } from './model.js'

/**
 * One vocabulary for where a player stands, in step with the Discord sign-up replies ("signed up",
 * "tentative", "absent"). An answer is never a place: only a published roster selects a player.
 */
export const STATUS = {
  noAnswer: 'No answer yet',
  signedUp: 'Signed up · awaiting roster',
  absent: 'Absent this week',
  selected: 'Selected · confirmation needed',
  confirmed: 'Confirmed',
  tentative: 'Selected · tentative',
  unavailable: 'Selected · can’t make it',
}

const BY_RESPONSE = {
  confirmed: STATUS.confirmed,
  tentative: STATUS.tentative,
  unavailable: STATUS.unavailable,
}

/** Where a player without a published place stands for the week; a usual schedule counts as signed up. */
export function weekStatus(state, weekIso, memberId) {
  const checkin = getCheckin(state, weekIso, memberId)
  if (checkin.checkedIn) return checkin.ranges.length ? STATUS.signedUp : STATUS.absent
  return templateFor(own(state.templates, memberId), weekIso) ? STATUS.signedUp : STATUS.noAnswer
}

/** Where a selected player stands, from their response to the published roster (or none yet). */
export function placeStatus(response) {
  return own(BY_RESPONSE, response?.status) ?? STATUS.selected
}
