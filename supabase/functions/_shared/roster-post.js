/**
 * Published roster cards with full-width role sections and talent spec icons.
 * Pings go in the message text, because Discord never pings from an embed, and edits never ping
 * again (see deliverMessages). Complete lists continue in additional messages; no name is dropped.
 */
import { escapeDiscord } from './raid-service-core.js'
import { entryLine } from './signup-post.js'
import { ROLE_HEADINGS, displayRoles, damageSummary } from './raid-presentation.js'
import { SIGNUP_ROLES } from './signup-lineup.js'
import { roleNeeds } from './raid-readiness.js'
import { listFields, fieldPages } from './discord-lists.js'
import { specEmojiName } from './spec-icons.js'
import { safeVoiceLink } from './raid-briefing.js'

/** Discord accepts at most 100 user mentions, and 2000 characters, per message. */
const MAX_MENTIONS = 100
const MAX_CONTENT = 2000
const COLORS = { published: 0x5865f2, withdrawn: 0x99aab5, cancelled: 0xed4245 }
const FOOTERS = {
  published: 'Published roster · Choose Confirm, Tentative, or Can’t attend',
  withdrawn: 'Roster withdrawn',
  cancelled: 'This raid has been cancelled',
}
const CLOSED = {
  withdrawn: '**This roster has been withdrawn. Await a new published roster.**',
  cancelled: '**This raid has been cancelled.**',
}

function statusOf(payload) {
  if (payload.cancelled) return 'cancelled'
  return payload.withdrawn ? 'withdrawn' : 'published'
}

/** Players grouped by role in published order, numbered down the card. */
function lineup(payload) {
  const team = payload.team ?? []
  let count = 0
  const numbered = (entry) => ({ ...entry, number: ++count })
  const budgetRoles = SIGNUP_ROLES.map((role, i) => ({
    role,
    target: Math.max(0, Math.floor(Number(payload.targets?.[i]) || 0)),
    members: team.filter((entry) => entry.role === role),
  }))
  const roles = displayRoles(budgetRoles).map((group) => ({ ...group, members: group.members.map(numbered) }))
  const other = team.filter((entry) => !SIGNUP_ROLES.includes(entry.role)).map(numbered)
  return { roles, budgetRoles, other, total: count }
}

/** M15: the officer's raid-day logistics, one short line each; nothing when the guild set none. */
export function briefingLines(briefing, start) {
  if (!briefing) return []
  const text = (value, max) => escapeDiscord(String(value).replace(/\s+/g, ' ').slice(0, max))
  const lines = []
  const minutes = Number(briefing.assemblyMinutes)
  const meet = Number.isInteger(minutes) && minutes > 0 && start
  if (meet || briefing.location) {
    const when = meet
      ? `Meet <t:${Math.floor((start - minutes * 60000) / 1000)}:t> (${minutes} min early)`
      : 'Meet'
    lines.push(`📍 ${when}${briefing.location ? ` · ${text(briefing.location, 120)}` : ''}`)
  }
  const voice = safeVoiceLink(briefing.voiceUrl)
  if (voice) lines.push(`🔊 [Voice chat (${voice.host})](${voice.href})`)
  if (briefing.contact) lines.push(`🙋 Problems? Contact ${text(briefing.contact, 80)}`)
  if (briefing.notes) lines.push(`📝 ${text(briefing.notes, 500)}`)
  if (briefing.weekNote) lines.push(`📌 This week: ${text(briefing.weekNote, 300)}`)
  return lines.length ? ['', ...lines] : []
}

function describe(payload, { budgetRoles, total }) {
  const seconds = Math.floor(payload.start / 1000)
  const counts = budgetRoles.map(
    ({ role, target, members }) =>
      `${ROLE_HEADINGS[role]} **${members.length}**${target ? `/${target}` : ''}`,
  )
  const needed = roleNeeds(
    budgetRoles.map(({ role, target, members }) => ({ role, missing: Math.max(0, target - members.length) })),
  )
  return [
    `🗓️ <t:${seconds}:F>`,
    `⏰ Starts <t:${seconds}:R>`,
    ...briefingLines(payload.briefing, payload.start),
    '',
    `${counts.join(' · ')} · **${total}** rostered`,
    damageSummary(budgetRoles),
    '',
    needed ? `**Still needed:** ${needed}` : 'All role targets filled.',
  ].join('\n')
}

function rosterFields({ roles, other }, specEmojis) {
  const rosterLine = (entry) => entryLine(entry, { specEmojis })
  const fields = roles.flatMap(({ role, target, members }) =>
    listFields(
      `${ROLE_HEADINGS[role]} (${members.length}${target ? `/${target}` : ''})`,
      members.map(rosterLine),
      { joiner: '\n\n' },
    ),
  )
  if (other.length)
    fields.push(...listFields(`❔ No role (${other.length})`, other.map(rosterLine), { joiner: '\n\n' }))
  return fields
}

/** Plain, bounded data for the colored roster image. The embed remains a readable text fallback. */
export function rosterImageModel(payload, specEmojis = {}) {
  const groups = lineup(payload)
  const imageHeadings = {
    Tank: 'Tanks',
    Healer: 'Healers',
    Melee: 'Melee DPS',
    Ranged: 'Ranged DPS',
    Unknown: 'DPS · spec needed',
  }
  const sections = [
    ...groups.roles.map(({ role, members }) => ({ title: imageHeadings[role] ?? role, members })),
    ...(groups.other.length ? [{ title: 'No role', members: groups.other }] : []),
    ...(payload.standby?.length ? [{ title: 'Available as backup', members: payload.standby }] : []),
  ]
  return {
    title: String(payload.raidName ?? 'Raid').slice(0, 100),
    sections: sections.map(({ title, members }) => ({
      title,
      members: members.map((entry) => {
        const name = String(entry.name || entry.player || 'Unknown player').slice(0, 80)
        const player =
          entry.player && entry.player !== entry.name ? ` (${String(entry.player).slice(0, 80)})` : ''
        const spec = entry.spec ? ` ${String(entry.spec).slice(0, 60)}` : ''
        const emojiName = specEmojiName(entry.class, entry.spec)
        const emojiId = specEmojis[emojiName]
        return {
          text: `${name}${player}${spec}`,
          color:
            title === 'Available as backup' ? 'yellow' : entry.response === 'confirmed' ? 'blue' : 'default',
          emojiId: /^\d{17,20}$/.test(emojiId ?? '') ? emojiId : null,
        }
      }),
    })),
  }
}

/** As many valid mentions as fit in one message's text. */
function pingLine(mentionIds) {
  const pings = []
  let length = '**Raiders:**'.length
  for (const id of mentionIds.filter((id) => /^\d{17,20}$/.test(id)).slice(0, MAX_MENTIONS)) {
    if (length + id.length + 4 > MAX_CONTENT) break
    pings.push(`<@${id}>`)
    length += id.length + 4
  }
  return pings.length ? `**Raiders:** ${pings.join(' ')}` : ''
}

/** `mentionIds`: players to ping (only on the first post; edits never ping again). */
export function rosterMessages(payload, mentionIds = [], { specEmojis = {} } = {}) {
  const status = statusOf(payload)
  const embed = {
    // Discord shows the author line as plain text (no markdown, no mentions), so it is not escaped.
    author: {
      name: String(payload.guildName ?? '')
        .replace(/[\r\n]/g, ' ')
        .slice(0, 256),
    },
    title: escapeDiscord(payload.raidName).slice(0, 256),
    color: COLORS[status],
    footer: { text: FOOTERS[status] },
    ...(payload.start ? { timestamp: new Date(payload.start).toISOString() } : {}),
  }
  if (status !== 'published') return [{ content: '', embeds: [{ ...embed, description: CLOSED[status] }] }]
  const groups = lineup(payload)
  const fields = rosterFields(groups, specEmojis)
  if (payload.standby?.length)
    fields.push(
      ...listFields(
        `Available as backup (${payload.standby.length})`,
        payload.standby.map((entry, index) => entryLine({ ...entry, number: index + 1 }, { specEmojis })),
        { joiner: '\n\n' },
      ),
    )
  const pages = fieldPages(fields)
  return pages.map((fields, index) => ({
    content: index ? '' : pingLine(mentionIds),
    embeds: [
      {
        ...embed,
        description: index
          ? `Roster continued · Page ${index + 1}/${pages.length}`
          : describe(payload, groups),
        fields,
        footer: {
          text: pages.length > 1 ? `${FOOTERS[status]} · Page ${index + 1}/${pages.length}` : FOOTERS[status],
        },
      },
    ],
  }))
}
