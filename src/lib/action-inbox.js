import { templateNeedsReview } from './availability-template.js'
import { checkinsClosed, deadlineUtc } from './checkins.js'
import { own } from './ids.js'
import { getCheckin } from './model.js'
import { personalRaids } from './personal-raids.js'
import { offerStatus } from './standby.js'
import { formatWeekRange, todayIso } from './time.js'

/**
 * M06: what a player still has to do, read from the same records the app and Discord write, so an
 * item disappears once it is done in either place. Only actions belong here; news does not.
 */

/** Where an item's button takes the player: the availability editor, or a control on Home. */
export const raidAnchor = (weekIso, raidId) => `raid-item-${weekIso}-${raidId}`
export const SCHEDULE_REVIEW_ANCHOR = 'schedule-review'

/**
 * @param {object} state
 * @param {string} memberId
 * @param {{
 *   now: number,
 *   thisWeek: string,
 *   responses?: Record<string, string | null>,
 *   offers?: object[],
 * }} context `responses` maps `week:raidId` to the player's answer (null when unanswered; a raid
 *   not yet loaded is left out). `offers` are the player's place offers.
 * @returns {{ id: string, kind: string, title: string, detail: string, anchor: string | null, due: number | null }[]}
 */
export function memberActions(state, memberId, { now, thisWeek, responses = {}, offers = [] }) {
  if (!memberId) return []
  const upcoming = personalRaids(state, memberId, now)
  const raidName = (raidId) => state.settings.raids.find((raid) => raid.id === raidId)?.name ?? 'a raid'
  const actions = []

  for (const offer of offers) {
    if (offer.member_id !== memberId || offerStatus(offer, now) !== 'open') continue
    actions.push({
      id: `offer:${offer.id}`,
      kind: 'offer',
      title: `Answer the place offered in ${raidName(offer.raid_id)}`,
      detail: 'Officers are waiting to hear whether you’ll take it.',
      anchor: raidAnchor(offer.week, offer.raid_id),
      due: Date.parse(offer.expires_at),
    })
  }

  for (const item of upcoming) {
    if (!item.assignment || item.session.start <= now) continue
    const key = `${item.weekIso}:${item.raidId}`
    if (!Object.hasOwn(responses, key) || responses[key]) continue
    actions.push({
      id: `confirm:${key}`,
      kind: 'confirm',
      title: `Confirm your place in ${item.raid.name}`,
      detail: 'Let your officers know you’ll be there, or tell them you can’t make it.',
      anchor: raidAnchor(item.weekIso, item.raidId),
      due: item.session.start,
    })
  }

  if (!getCheckin(state, thisWeek, memberId).checkedIn && !checkinsClosed(state, thisWeek, now)) {
    actions.push({
      id: `availability:${thisWeek}`,
      kind: 'availability',
      title: `Give your availability for ${formatWeekRange(thisWeek)}`,
      detail: 'Your officers plan the week around it.',
      anchor: null,
      due: deadlineUtc(state, thisWeek),
    })
  }

  if (templateNeedsReview(own(state.templates, memberId), todayIso(state.guild.timezone, now))) {
    actions.push({
      id: 'schedule-review',
      kind: 'schedule',
      title: 'Check your usual schedule is still right',
      detail: 'It fills in weeks you don’t answer yourself.',
      anchor: SCHEDULE_REVIEW_ANCHOR,
      due: null,
    })
  }

  // Soonest deadline first; items without one go last, in the order above.
  return actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => (a.action.due ?? Infinity) - (b.action.due ?? Infinity) || a.index - b.index)
    .map(({ action }) => action)
}
