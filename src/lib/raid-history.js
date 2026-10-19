import { ROLES } from './constants.js'
import { characterById, memberById, setPlan } from './model.js'
import { getRaid } from './raids.js'

/**
 * M13: a raid's recorded changes (see 20261102120000_raid_history.sql) as readable text, and
 * restoring the roster from before a change as a new draft. Restoring never touches the published
 * roster, responses, or attendance; publishing it stays a separate step.
 *
 * @typedef {{ memberId: string, characterId: string, role: string }} Entry
 * @typedef {{ added: Entry[], removed: Entry[], changed: { from: Entry, to: Entry }[] }} RosterDiff
 * @typedef {{ id: string, at: string, actor_member_id: string | null, actor_name: string | null,
 *   kind: string, visibility: string, affects: string[], details: object,
 *   before: { start: number, team: Entry[], locked: string[] } | null, reason: string | null }} HistoryEvent
 */

const ATTENDANCE = { attended: 'attended', late: 'late', noshow: 'no-show' }

/** "Sat, Oct 3, 7:00 PM" in `zone`. */
export const formatWhen = (instant, zone) =>
  new Date(instant).toLocaleString('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

function names(state) {
  const member = (id) => memberById(state, id)?.name ?? 'A former player'
  const character = (entry) => characterById(state, entry.characterId)?.name ?? 'a deleted character'
  return { member, character }
}

const HEADLINES = {
  draft: 'changed the draft roster',
  published: 'published the roster',
  withdrawn: 'withdrew the published roster',
  cancelled: 'cancelled the raid',
  uncancelled: 'put the raid back on',
  attendance: 'updated attendance',
  removed: 'cleared this raid’s plan',
}

function headlineOf(event) {
  const actor = event.actor_name ?? 'WhenToRaid'
  const action =
    event.kind === 'published' && event.details.republished ? 'republished the roster' : HEADLINES[event.kind]
  return `${actor} ${action}`
}

function rosterLines(diff, { member, character }) {
  if (!diff) return []
  return [
    ...diff.added.map((e) => `Added ${member(e.memberId)} (${character(e)}, ${e.role})`),
    ...diff.removed.map((e) => `Removed ${member(e.memberId)}`),
    ...diff.changed.map(
      ({ from, to }) =>
        `${member(to.memberId)}: ${character(from)} (${from.role}) → ${character(to)} (${to.role})`,
    ),
  ]
}

function timeLine(details, zone) {
  const { fromStart, toStart } = details
  if (fromStart == null || toStart == null || Number(fromStart) === Number(toStart)) return []
  return [`Time: ${formatWhen(Number(fromStart), zone)} → ${formatWhen(Number(toStart), zone)}`]
}

/**
 * An officer's view of one change: who did what, and each detail.
 * @param {HistoryEvent} event
 * @returns {{ headline: string, lines: string[] }}
 */
export function describeChange(event, state, zone) {
  const label = names(state)
  const lines = [...rosterLines(event.details.roster, label), ...timeLine(event.details, zone)]
  for (const [memberId, { from, to }] of Object.entries(event.details.attendance ?? {}))
    lines.push(
      `${label.member(memberId)}: ${ATTENDANCE[from] ?? 'not marked'} → ${ATTENDANCE[to] ?? 'not marked'}`,
    )
  return { headline: headlineOf(event), lines }
}

/**
 * A player's view of a published change: only what it meant for their own place.
 * @param {HistoryEvent} event
 * @returns {{ headline: string, lines: string[] }}
 */
export function memberView(event, state, memberId, zone) {
  const label = names(state)
  const diff = event.details.roster
  const lines = []
  if (diff?.added.some((e) => e.memberId === memberId)) lines.push('You were added to the roster.')
  if (diff?.removed.some((e) => e.memberId === memberId)) lines.push('You are no longer on the roster.')
  for (const { from, to } of diff?.changed ?? [])
    if (to.memberId === memberId)
      lines.push(
        `Your assignment changed: ${label.character(from)} (${from.role}) → ${label.character(to)} (${to.role}).`,
      )
  lines.push(...timeLine(event.details, zone))
  return { headline: headlineOf(event), lines }
}

function dropReason(state, raid, team, entry) {
  const character = characterById(state, entry.characterId)
  const roleIndex = ROLES.indexOf(entry.role)
  if (!memberById(state, entry.memberId)) return 'no longer in the guild'
  if (!character || character.memberId !== entry.memberId) return 'that character no longer exists'
  if (character.retired) return 'that character was deleted'
  if (roleIndex < 0) return 'unknown role'
  if (team.some((e) => e.memberId === entry.memberId)) return 'listed twice'
  if (team.filter((e) => e.role === entry.role).length >= raid.targets[roleIndex])
    return `the raid now takes fewer ${entry.role} players`
  return null
}

/**
 * What restoring `before` as this raid's draft would give, checked against the guild as it is now.
 * The current raid time is kept; players who can no longer be placed are listed with the reason.
 * @returns {{ error: string } | { team: Entry[], locked: string[], start: number,
 *   dropped: { entry: Entry, reason: string }[], joins: string[], leaves: string[], timeKept: boolean }}
 */
export function restorePreview(state, weekIso, raidId, before, now = Date.now()) {
  const current = state.weeks[weekIso]?.plans[raidId]
  const start = current?.start ?? before.start
  if (start <= now) return { error: 'This raid has started, so its roster and attendance stay as recorded.' }
  if (current?.cancelled)
    return { error: 'This raid is cancelled. Put it back on before restoring a roster.' }
  const raid = getRaid(state, raidId)
  const team = []
  const dropped = []
  for (const entry of before.team) {
    const reason = dropReason(state, raid, team, entry)
    if (reason) dropped.push({ entry, reason })
    else team.push({ ...entry })
  }
  const onDraft = new Set((current?.team ?? []).map((e) => e.memberId))
  const restored = new Set(team.map((e) => e.memberId))
  return {
    team,
    locked: (before.locked ?? []).filter((id) => restored.has(id)),
    start,
    dropped,
    joins: [...restored].filter((id) => !onDraft.has(id)),
    leaves: [...onDraft].filter((id) => !restored.has(id)),
    timeKept: before.start !== start,
  }
}

/** The state with `preview`'s roster as the draft of that raid; nothing else changes. */
export function restoreRoster(state, weekIso, raidId, preview) {
  const current = state.weeks[weekIso]?.plans[raidId]
  const scoped = setPlan({ ...state, currentRaidId: raidId }, weekIso, {
    start: preview.start,
    team: preview.team,
    locked: preview.locked,
    attendance: current?.attendance ?? {},
    cancelled: current?.cancelled ?? false,
  })
  return { ...scoped, currentRaidId: state.currentRaidId }
}
