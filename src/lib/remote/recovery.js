import { checkinsClosed, deadlineUtc, formatDeadline } from '../checkins.js'
import { formatDateIn, formatTimesIn } from '../grid.js'
import { formatMonthDay } from '../time.js'
import { keyOf, stableJson, TABLES } from './rows.js'

/**
 * M12: an online edit that was not saved, described task by task in the player's terms ("Your
 * availability for the week of Oct 19: Fri, online 7:00 pm – 10:00 pm, yours 8:00 pm – 10:00 pm")
 * instead of as a whole reloaded guild. Pure: it compares the rows the edit started from (`base`),
 * the edited rows (`draft`), and what the server holds now (`server`).
 *
 * @typedef {'ready' | 'conflict' | 'saved' | 'gone' | 'forbidden' | 'closed'} Outcome
 * @typedef {{ label: string, online: string, yours: string }} Difference
 * @typedef {{ id: string, table: string, task: string, title: string, outcome: Outcome,
 *   reason: string, differences: Difference[], week?: string }} UnsavedChange
 */

/** Outcomes a retry can still apply; the rest are dropped from a retry, with the reason shown. */
export const APPLICABLE = new Set(['ready', 'conflict'])

const NOT_SET = 'Not set'
const TASKS = {
  guilds: 'settings',
  members: 'member',
  characters: 'character',
  availability_templates: 'usual',
  checkins: 'availability',
  plans: 'roster',
}
/** Rows a player may change for themselves; everything else needs an officer (as the database rules). */
const OWNED = {
  members: 'id',
  characters: 'member_id',
  availability_templates: 'member_id',
  checkins: 'member_id',
}

const index = (rows, table) => new Map((rows?.[table] ?? []).map((row) => [keyOf(table, row), row]))
const same = (a, b) => stableJson(a) === stableJson(b)

/** Firm times by day in `zone`: { 'Fri Oct 23': '7:00 pm – 10:00 pm' }. */
function timesByDay(ranges, zone) {
  const days = {}
  for (const range of [...(ranges ?? [])].sort((a, b) => a.start - b.start)) {
    const day = formatDateIn(range, zone)
    days[day] = days[day] ? `${days[day]}, ${formatTimesIn(range, zone)}` : formatTimesIn(range, zone)
  }
  return days
}

function availabilityDifferences(online, yours, zone) {
  const before = timesByDay(online?.ranges, zone)
  const after = timesByDay(yours?.ranges, zone)
  const days = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const differences = days
    .filter((day) => before[day] !== after[day])
    .map((day) => ({
      label: day,
      online: before[day] ?? 'Not available',
      yours: after[day] ?? 'Not available',
    }))
  const others = [
    ['Answered', (row) => (row ? (row.checked_in ? 'Yes' : 'No') : 'No answer yet')],
    [
      'Tentative or preferred times',
      (row) => stableJson([row?.availability?.tentative, row?.availability?.preferred]),
    ],
    ['Away dates', (row) => (row?.availability?.absent ?? []).map(formatMonthDay).join(', ') || 'None'],
    ['Characters sitting out', (row) => String((row?.declined ?? []).length)],
    ['Raid choices', (row) => stableJson(row?.raid_preferences ?? {})],
  ]
  for (const [label, show] of others) {
    if (show(online) === show(yours)) continue
    // Only readable values are shown; the rest just say they differ.
    const readable = label === 'Answered' || label === 'Away dates'
    differences.push({
      label,
      online: readable ? show(online) : 'As saved online',
      yours: readable ? show(yours) : 'Changed',
    })
  }
  return differences
}

/** Field-by-field differences for rows whose columns read as plain text. */
function fieldDifferences(online, yours, fields) {
  if (!online || !yours) return []
  return fields
    .filter(([, column]) => !same(online[column], yours[column]))
    .map(([label, column, show = (v) => String(v ?? '') || NOT_SET]) => ({
      label,
      online: show(online[column]),
      yours: show(yours[column]),
    }))
}

const yesNo = (value) => (value ? 'Yes' : 'No')
const CHARACTER_FIELDS = [
  ['Name', 'name'],
  ['Realm', 'realm'],
  ['Class', 'class'],
  ['Spec', 'spec'],
  ['Role', 'role'],
  ['Main', 'main', yesNo],
  ['Retired', 'retired', yesNo],
]
const MEMBER_FIELDS = [
  ['Name', 'name'],
  ['Officer', 'is_officer', yesNo],
]
const GUILD_FIELDS = [
  ['Guild name', 'name'],
  ['Timezone', 'timezone'],
  ['Raid profiles and rules', 'settings', () => 'Changed'],
  ['Discord server', 'discord_server_id'],
  ['Officer roles', 'officer_role_ids'],
]

function planSummary(row) {
  if (!row) return 'No plan'
  if (row.cancelled) return 'Cancelled'
  const players = `${row.team.length} ${row.team.length === 1 ? 'player' : 'players'}`
  return row.published ? `${players}, published` : `${players}, draft`
}

function planDifferences(online, yours) {
  const differences = []
  if (planSummary(online) !== planSummary(yours))
    differences.push({ label: 'Roster', online: planSummary(online), yours: planSummary(yours) })
  if (online && yours && !same(online.attendance, yours.attendance))
    differences.push({ label: 'Attendance', online: 'As saved online', yours: 'Changed' })
  if (!differences.length && online && yours)
    differences.push({ label: 'Roster', online: 'As saved online', yours: 'Changed' })
  return differences
}

function describe(table, row, ctx) {
  const name = (memberId) => ctx.memberNames.get(memberId) ?? 'A former player'
  const whose = (memberId) => (memberId === ctx.memberId ? 'Your' : `${name(memberId)}’s`)
  switch (table) {
    case 'guilds':
      return 'Guild settings'
    case 'members':
      return row.id === ctx.memberId ? 'Your player name' : `Player ${row.name}`
    case 'characters':
      return `${whose(row.member_id)} character ${row.name}`
    case 'availability_templates':
      return `${whose(row.member_id)} usual schedule`
    case 'checkins':
      return `${whose(row.member_id)} availability for the week of ${formatMonthDay(row.week)}`
    case 'plans': {
      const raid = ctx.raidNames.get(row.raid_id) ?? 'Raid'
      return `${raid} roster, week of ${formatMonthDay(row.week)}`
    }
  }
}

function differencesFor(table, online, yours, zone) {
  const added = !online && yours
  const removed = online && !yours
  if (table === 'checkins') return availabilityDifferences(online, yours, zone)
  if (table === 'plans') return planDifferences(online, yours)
  if (added) return [{ label: 'Change', online: 'Not there online', yours: 'Added' }]
  if (removed) return [{ label: 'Change', online: 'Still there online', yours: 'Removed' }]
  if (table === 'characters') return fieldDifferences(online, yours, CHARACTER_FIELDS)
  if (table === 'members') return fieldDifferences(online, yours, MEMBER_FIELDS)
  if (table === 'guilds') return fieldDifferences(online, yours, GUILD_FIELDS)
  return [{ label: 'Usual times', online: 'As saved online', yours: 'Changed' }]
}

const REASONS = {
  ready: 'Nobody else changed this. Saving again applies it.',
  conflict: 'Someone changed this online after you started. Saving yours replaces the online version.',
  saved: 'The online version already matches your change.',
  gone: 'This was removed online, so your change can no longer be applied.',
  forbidden: 'Only officers can change this now, so your change can no longer be applied.',
}

/**
 * @param {import('./rows.js').Rows} base the rows the edit started from
 * @param {import('./rows.js').Rows} draft the edited rows
 * @param {import('./rows.js').Rows} server the rows online now
 * @param {{ state: import('../model.js').AppState, memberId: string, officer: boolean, zone: string, now?: number }} ctx
 *   `state` is the guild as loaded now (names, deadlines).
 * @returns {UnsavedChange[]}
 */
export function unsavedChanges(base, draft, server, { state, memberId, officer, zone, now = Date.now() }) {
  const ctx = {
    memberId,
    memberNames: new Map([...(draft.members ?? []), ...(server.members ?? [])].map((m) => [m.id, m.name])),
    raidNames: new Map((state.settings?.raids ?? []).map((raid) => [raid.id, raid.name])),
  }
  const serverMembers = new Set((server.members ?? []).map((m) => m.id))
  const changes = []
  for (const table of TABLES) {
    const before = index(base, table)
    const ours = index(draft, table)
    const theirs = index(server, table)
    for (const key of new Set([...before.keys(), ...ours.keys()])) {
      const original = before.get(key)
      const yours = ours.get(key)
      if (same(original, yours)) continue
      const online = theirs.get(key)
      const row = yours ?? original
      const owner = OWNED[table] ? row[OWNED[table]] : null
      let outcome
      let reason
      if (same(online, yours)) outcome = 'saved'
      else if (!officer && owner !== memberId) outcome = 'forbidden'
      else if (
        yours &&
        ((original && !online) || (table !== 'members' && owner && !serverMembers.has(owner)))
      )
        outcome = 'gone'
      else if (table === 'checkins' && !officer && checkinsClosed(state, row.week, now)) {
        outcome = 'closed'
        reason = `Check-ins for this week closed ${formatDeadline(deadlineUtc(state, row.week), zone)}. Ask an officer to change it.`
      } else outcome = same(online, original) ? 'ready' : 'conflict'
      changes.push({
        id: `${table}:${key}`,
        table,
        task: TASKS[table],
        title: describe(table, row, ctx),
        outcome,
        reason: reason ?? REASONS[outcome],
        differences: differencesFor(table, online, yours, zone),
        ...(row.week ? { week: row.week } : {}),
      })
    }
  }
  return changes
}

/**
 * `draft` with the change `id` undone: its row put back as it was in `base`.
 * @returns {import('./rows.js').Rows}
 */
export function withoutChange(base, draft, id) {
  const [table, ...rest] = id.split(':')
  const key = rest.join(':')
  const original = index(base, table).get(key)
  const rows = (draft[table] ?? []).filter((row) => keyOf(table, row) !== key)
  return { ...draft, [table]: original ? [...rows, original] : rows }
}
