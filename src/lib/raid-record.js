import { RECORD_LOOKBACK_WEEKS } from './attendance.js'
import { raidRules } from './composition-rules.js'
import { SLOT_MINUTES } from './constants.js'
import { isAvailable } from './engine.js'
import { own } from './ids.js'
import { enginePlayers } from './model.js'
import { BENCH_LOOKBACK_WEEKS, benchHistory } from './planning.js'
import { addDays } from './time.js'

/**
 * M08: a player's own recent raids, keeping apart what they volunteered for (free and offering a
 * character), whether officers picked them, and what was recorded once the raid ran. Sit-outs are
 * counted exactly as the planner counts them, so the record explains the real fairness input.
 */

const DAYS_PER_WEEK = 7

/** What a row says about the player's part in one past raid. */
export const OUTCOMES = {
  attended: 'Played',
  late: 'Played, arrived late',
  noshow: 'No-show recorded',
  rostered: 'On the roster, nothing recorded',
  'sat-out': 'Sat out',
  away: 'Not available',
  cancelled: 'Cancelled, did not run',
}

/** How each roster priority treats sit-outs, in the words a player needs. */
export const PRIORITY_EXPLANATIONS = {
  fairness:
    'When more players fit a roster than there are places, the planner first prefers players who sat out more of these weeks.',
  mains:
    'When more players fit a roster than there are places, the planner first prefers main characters, then players who sat out more of these weeks.',
  preferred:
    'When more players fit a roster than there are places, the planner first prefers players who marked the time as preferred, then players who sat out more of these weeks.',
}

/**
 * The player's raids that have ended, newest first, over the last `RECORD_LOOKBACK_WEEKS` weeks.
 * @returns {{ weekIso: string, raidId: string, raidName: string, start: number, volunteered: boolean,
 *   selected: boolean, outcome: keyof OUTCOMES, countsForFairness: boolean }[]}
 */
export function personalRecord(state, memberId, thisWeek, now = Date.now()) {
  if (!memberId) return []
  const rows = []
  for (let weeksAgo = 0; weeksAgo < RECORD_LOOKBACK_WEEKS; weeksAgo++) {
    const weekIso = addDays(thisWeek, -DAYS_PER_WEEK * weeksAgo)
    for (const raid of state.settings.raids) {
      const draft = own(state.weeks[weekIso]?.plans ?? {}, raid.id)
      // The same roster the fairness count reads: what was published, else the saved plan.
      const plan = draft?.published ?? draft
      if (!plan) continue
      const window = {
        start: plan.start,
        end: plan.end ?? plan.start + raid.durationSlots * SLOT_MINUTES * 60_000,
      }
      if (window.end > now) continue
      const player = enginePlayers({ ...state, currentRaidId: raid.id }, weekIso).find(
        (p) => p.id === memberId,
      )
      const volunteered =
        Boolean(player) && isAvailable(player, window) && player.characters.some((c) => c.offered)
      const selected = plan.team.some((entry) => entry.memberId === memberId)
      const outcome = draft.cancelled
        ? 'cancelled'
        : selected
          ? (draft.attendance?.[memberId] ?? 'rostered')
          : volunteered
            ? 'sat-out'
            : 'away'
      rows.push({
        weekIso,
        raidId: raid.id,
        raidName: raid.name,
        start: plan.start,
        volunteered,
        selected,
        outcome,
        countsForFairness: outcome === 'sat-out' && weeksAgo >= 1 && weeksAgo <= BENCH_LOOKBACK_WEEKS,
      })
    }
  }
  return rows.sort((a, b) => b.start - a.start)
}

/** Per raid: the sit-out count the planner uses for this week's roster, and the raid's priority. */
export function fairnessSummary(state, memberId, thisWeek) {
  return state.settings.raids.map((raid) => ({
    raidId: raid.id,
    raidName: raid.name,
    satOut: benchHistory({ ...state, currentRaidId: raid.id }, thisWeek).get(memberId) ?? 0,
    priority: raidRules(raid).priority,
  }))
}

/**
 * The newest correction a player has asked for on one raid (open or answered), or null.
 * `flags` are rows from get_raid_record_flags, newest first.
 */
export const latestFlag = (flags, weekIso, raidId, memberId) =>
  flags.find((f) => f.week === weekIso && f.raid_id === raidId && f.member_id === memberId) ?? null
