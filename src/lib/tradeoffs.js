import { SUGGESTION_RANKING } from './planning.js'

/**
 * M09: why one suggested window ranks above another, from the planner's own ranking, and what
 * changes in the roster by choosing the other. Officer edits are reported apart from the algorithm.
 */

/** A raid's roster priority (its within-window tie-breaker), as the rules editor names it. */
export const PRIORITY_LABELS = {
  fairness: 'players who sat out recently',
  mains: 'main characters',
  preferred: 'players who marked the time as preferred',
}

const ids = (team) => new Set(team.map((entry) => entry.memberId))

/**
 * @param {import('./planning.js').Suggestion} first the higher-ranked window
 * @param {import('./planning.js').Suggestion} other
 * @returns {{
 *   rows: { key: string, label: string, first: number, other: number, decisive: boolean }[],
 *   decidedBy: string | null,
 *   joins: string[],
 *   leaves: string[],
 * }} `decidedBy` names the first criterion that differs ("Earlier start" when only the time does).
 */
export function compareSuggestions(first, other) {
  let decided = false
  let decidedBy = null
  const rows = SUGGESTION_RANKING.map(({ key, label, value }) => {
    const a = value(first)
    const b = value(other)
    const decisive = !decided && a !== b
    if (decisive) {
      decided = true
      decidedBy = label
    }
    return { key, label, first: a, other: b, decisive }
  })
  if (!decided && first.start !== other.start) decidedBy = 'Earlier start'
  const firstIds = ids(first.team)
  const otherIds = ids(other.team)
  return {
    rows,
    decidedBy,
    joins: [...otherIds].filter((id) => !firstIds.has(id)),
    leaves: [...firstIds].filter((id) => !otherIds.has(id)),
  }
}

/**
 * How an officer's saved roster differs from what the planner suggests for the same window.
 * Null when there is no saved roster or it matches the suggestion.
 */
export function officerChanges(savedTeam, suggestion) {
  if (!savedTeam || !suggestion) return null
  const saved = ids(savedTeam)
  const suggested = ids(suggestion.team)
  const added = [...saved].filter((id) => !suggested.has(id))
  const removed = [...suggested].filter((id) => !saved.has(id))
  return added.length || removed.length ? { added, removed } : null
}
