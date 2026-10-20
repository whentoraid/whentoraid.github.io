/**
 * Character setup in Discord, for players who never open the website. A private menu chooses the
 * class, a second the spec, and a form names the character; /raid characters also chooses a main and
 * deletes characters. Started from a sign-up press, the setup carries that press along (the "context":
 * delivery, post and status) so finishing it signs the player up. Pure parsing and replies; the
 * raid-interactions handler makes the calls.
 */
import { escapeDiscord } from './raid-service-core.js'

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
/** `me` from /raid characters, or the sign-up press being finished: `<delivery id>:<post id>:<status>`. */
const CONTEXT = `(me|${UUID}:(\\d{17,20}):(signed|late|tentative|absent))`
const CLASS_MENU_ID = new RegExp(`^wcc:${CONTEXT}$`)
const SPEC_MENU_ID = new RegExp(`^wcp:${CONTEXT}:(\\d)$`)
const FORM_ID = new RegExp(`^wcn:${CONTEXT}:(\\d):(\\d)$`)
const DELETE_ID = /^wcx:([A-Za-z0-9_-]{1,64})$/
const CHARACTER_ID = /^[A-Za-z0-9_-]{1,64}$/
const SNOWFLAKE = /^\d{17,20}$/

const COMPONENT = 3
const MODAL_SUBMIT = 5
const ACTION_ROW = 1
const BUTTON = 2
const STRING_SELECT = 3
const TEXT_INPUT = 4
const STYLE_SECONDARY = 2
const STYLE_DANGER = 4
const STYLE_LINK = 5
const SHORT = 1
const MAX_LABEL = 100
const MAX_TITLE = 45
const MAX_CHARACTERS = 20
const MAX_NAME = 30
const MAX_REALM = 60

/**
 * Classic Era specs per class, with the raid role each signs up as, in the in-game order. Mirrors
 * class_spec_roles() in the database and SPEC_ROLES in src/lib/constants.js (a test keeps them in
 * step); Feral Combat is offered as tank and as damage.
 */
export const CLASS_SPEC_CHOICES = {
  Warrior: [
    ['Arms', 'DPS'],
    ['Fury', 'DPS'],
    ['Protection', 'Tank'],
  ],
  Paladin: [
    ['Holy', 'Healer'],
    ['Protection', 'Tank'],
    ['Retribution', 'DPS'],
  ],
  Hunter: [
    ['Beast Mastery', 'DPS'],
    ['Marksmanship', 'DPS'],
    ['Survival', 'DPS'],
  ],
  Rogue: [
    ['Assassination', 'DPS'],
    ['Combat', 'DPS'],
    ['Subtlety', 'DPS'],
  ],
  Priest: [
    ['Discipline', 'Healer'],
    ['Holy', 'Healer'],
    ['Shadow', 'DPS'],
  ],
  Shaman: [
    ['Elemental', 'DPS'],
    ['Enhancement', 'DPS'],
    ['Restoration', 'Healer'],
  ],
  Mage: [
    ['Arcane', 'DPS'],
    ['Fire', 'DPS'],
    ['Frost', 'DPS'],
  ],
  Warlock: [
    ['Affliction', 'DPS'],
    ['Demonology', 'DPS'],
    ['Destruction', 'DPS'],
  ],
  Druid: [
    ['Balance', 'DPS'],
    ['Feral Combat', 'Tank'],
    ['Feral Combat', 'DPS'],
    ['Restoration', 'Healer'],
  ],
}
const CLASSES = Object.keys(CLASS_SPEC_CHOICES)

/** Who is asking, as the player-scoped calls take it: only from the signed interaction, on a bot message. */
export function signedPlayer(interaction, applicationId) {
  const user = interaction.member?.user?.id
  const { guild_id: server, channel_id: channel, message } = interaction
  if (![interaction.id, server, channel, user].every((id) => SNOWFLAKE.test(id ?? ''))) return null
  if (!SNOWFLAKE.test(message?.id ?? '') || message?.author?.id !== applicationId) return null
  return { p_discord_id: user, p_discord_guild_id: server, p_channel_id: channel }
}

function contextOf(match) {
  if (match[1] === 'me') return { context: 'me', signup: null }
  return {
    context: match[1],
    signup: { p_delivery_id: match[2], p_message_id: match[3], p_status: match[4] },
  }
}

function choiceOf(classIndex, specIndex) {
  const className = CLASSES[Number(classIndex)]
  const choice = className && CLASS_SPEC_CHOICES[className][Number(specIndex)]
  return choice ? { className, spec: choice[0], role: choice[1] } : null
}

/** Text fields of a submitted form, by custom_id, in either of the shapes Discord sends. */
function formValues(components, values = {}) {
  for (const item of Array.isArray(components) ? components : []) {
    if (item?.type === TEXT_INPUT && typeof item.custom_id === 'string' && typeof item.value === 'string')
      values[item.custom_id] = item.value
    if (item?.components) formValues(item.components, values)
    if (item?.component) formValues([item.component], values)
  }
  return values
}

const only = (values) => (Array.isArray(values) && values.length === 1 ? values[0] : null)

function parseForm(interaction, who) {
  const match = FORM_ID.exec(interaction.data.custom_id)
  const choice = match && choiceOf(match[5], match[6])
  if (!choice) return null
  const { name = '', realm = '' } = formValues(interaction.data.components)
  const trimmed = { name: name.trim(), realm: realm.trim() }
  // Counted in characters, as Discord and Postgres count them, not UTF-16 units.
  const fits = (text, max) => text.length > 0 && [...text].length <= max
  if (!fits(trimmed.name, MAX_NAME) || !fits(trimmed.realm, MAX_REALM)) return { kind: 'form-invalid', who }
  return { kind: 'form', who, ...contextOf(match), choice, ...trimmed, interactionId: interaction.id }
}

function parseMenu(interaction, who) {
  const { data } = interaction
  const value = only(data.values)
  if (typeof value !== 'string') return null
  let match = CLASS_MENU_ID.exec(data.custom_id)
  if (match) {
    const classIndex = CLASSES.indexOf(value)
    return classIndex < 0 ? null : { kind: 'class', who, ...contextOf(match), classIndex }
  }
  match = SPEC_MENU_ID.exec(data.custom_id)
  if (match) {
    const choice = /^\d$/.test(value) && choiceOf(match[5], value)
    if (!choice) return null
    return {
      kind: 'spec',
      who,
      ...contextOf(match),
      classIndex: Number(match[5]),
      specIndex: Number(value),
      choice,
    }
  }
  if (!CHARACTER_ID.test(value)) return null
  if (data.custom_id === 'wcm:me') return { kind: 'main', who, characterId: value }
  if (data.custom_id !== 'wcr:me') return null
  // The name shown in the confirmation comes from the menu this bot sent, not from the player.
  const option = (interaction.message.components ?? [])
    .flatMap((row) => row?.components ?? [])
    .find((component) => component?.custom_id === 'wcr:me')
    ?.options?.find((o) => o?.value === value)
  return { kind: 'remove', who, characterId: value, label: option?.label }
}

/**
 * A character menu choice, button press or submitted form, or null for anything else.
 * @returns {null | { kind: 'class'|'spec'|'form'|'form-invalid'|'main'|'remove'|'delete'|'keep', who: object,
 *   context?: string, signup?: object | null, classIndex?: number, specIndex?: number,
 *   choice?: { className: string, spec: string, role: string }, name?: string, realm?: string,
 *   characterId?: string, label?: string, interactionId?: string }}
 */
export function parseCharacterInteraction(interaction, applicationId) {
  const who = signedPlayer(interaction, applicationId)
  if (!who || typeof interaction.data?.custom_id !== 'string') return null
  if (interaction.type === MODAL_SUBMIT) return parseForm(interaction, who)
  if (interaction.type !== COMPONENT) return null
  if (interaction.data.component_type === STRING_SELECT) return parseMenu(interaction, who)
  if (interaction.data.component_type !== BUTTON) return null
  if (interaction.data.custom_id === 'wck:me') return { kind: 'keep', who }
  const match = DELETE_ID.exec(interaction.data.custom_id)
  return match ? { kind: 'delete', who, characterId: match[1] } : null
}

/** "Thrall — Restoration Shaman (Healer)". Menu labels are plain text; message text is escaped. */
const describe = (c, escape = (text) => text) =>
  `${escape(c.name)} — ${[c.spec, c.class].filter(Boolean).join(' ')}${c.role ? ` (${c.role})` : ''}`

/** The "choose a class" menu that starts adding a character. */
export function classMenuRow(context, placeholder = 'Add a character: choose its class') {
  return {
    type: ACTION_ROW,
    components: [
      {
        type: STRING_SELECT,
        custom_id: `wcc:${context}`,
        placeholder,
        options: CLASSES.map((name) => ({ label: name, value: name })),
      },
    ],
  }
}

/** The start of setup from a sign-up press by a player with no characters. */
export function firstCharacterReply(signup, websiteLink) {
  const context = `${signup.p_delivery_id}:${signup.p_message_id}:${signup.p_status}`
  return {
    content: "You don't have a character yet. Add the one you're bringing and you'll be signed up.",
    components: [
      classMenuRow(context, "Choose your character's class"),
      ...(websiteLink
        ? [
            {
              type: ACTION_ROW,
              components: [
                { type: BUTTON, style: STYLE_LINK, label: 'Or use the website', url: websiteLink },
              ],
            },
          ]
        : []),
    ],
  }
}

/** Second step: the specs of the chosen class. */
export function specMenuReply({ context, classIndex }) {
  const className = CLASSES[classIndex]
  return {
    content: `Which spec does your ${className} play?`,
    components: [
      {
        type: ACTION_ROW,
        components: [
          {
            type: STRING_SELECT,
            custom_id: `wcp:${context}:${classIndex}`,
            placeholder: 'Choose a spec',
            options: CLASS_SPEC_CHOICES[className].map(([spec, role], index) => ({
              label: `${spec} · ${role}`,
              value: String(index),
            })),
          },
        ],
      },
    ],
  }
}

/** Last step: a form for the name and realm, the realm filled in when there is a likely one. */
export function characterForm({ context, classIndex, specIndex, choice }, realm) {
  const input = (custom_id, label, max_length, value) => ({
    type: ACTION_ROW,
    components: [
      {
        type: TEXT_INPUT,
        custom_id,
        label,
        style: SHORT,
        min_length: 1,
        max_length,
        required: true,
        ...(value ? { value: value.slice(0, max_length) } : {}),
      },
    ],
  })
  return {
    custom_id: `wcn:${context}:${classIndex}:${specIndex}`,
    title: `New ${choice.spec} ${choice.className}`.slice(0, MAX_TITLE),
    components: [input('name', 'Character name', MAX_NAME), input('realm', 'Realm', MAX_REALM, realm)],
  }
}

/** Worded as the other /raid replies. */
export const LOOKUP_OUTCOMES = {
  'not-member':
    'Your Discord account is not linked to a WhenToRaid guild in this server. Ask an officer for an invite link.',
  ambiguous:
    'You belong to several guilds in this server. Run /raid in your guild’s connected bot channel. If they share a channel, ask an officer to give each guild its own channel.',
}

/** The private /raid characters reply: the player's characters and menus to add, choose a main, delete. */
export function characterListReply(data, notice) {
  if (data?.outcome !== 'ok')
    return {
      content:
        LOOKUP_OUTCOMES[data?.outcome] ?? 'Your characters could not be loaded. Try again in a moment.',
      embeds: [],
      components: [],
    }
  const characters = data.characters ?? []
  const lines = characters.map(
    (c) => `${c.main ? '⭐' : '•'} ${describe(c, escapeDiscord)} · ${escapeDiscord(c.realm)}`,
  )
  const heading = characters.length
    ? `**Your characters**${data.guildName ? ` in ${escapeDiscord(data.guildName)}` : ''} (⭐ is your main)`
    : "You don't have any characters yet. Choose a class below to add your first."
  const options = characters.map((c) => ({ label: describe(c).slice(0, MAX_LABEL), value: c.id }))
  const menu = (custom_id, placeholder) => ({
    type: ACTION_ROW,
    components: [{ type: STRING_SELECT, custom_id, placeholder, options }],
  })
  return {
    content: [notice, heading, ...lines].filter(Boolean).join('\n'),
    embeds: [],
    components: [
      ...(characters.length < MAX_CHARACTERS ? [classMenuRow('me')] : []),
      ...(characters.length > 1
        ? [menu('wcm:me', 'Choose your main'), menu('wcr:me', 'Delete a character')]
        : []),
    ],
  }
}

/** Ask before deleting: rosters keep the character, but the player cannot bring it back here. */
export function deleteConfirmReply({ characterId, label }) {
  return {
    content: `Delete ${label ? `**${escapeDiscord(label)}**` : 'this character'}? Past rosters and attendance keep it.`,
    components: [
      {
        type: ACTION_ROW,
        components: [
          { type: BUTTON, style: STYLE_DANGER, label: 'Delete', custom_id: `wcx:${characterId}` },
          { type: BUTTON, style: STYLE_SECONDARY, label: 'Keep it', custom_id: 'wck:me' },
        ],
      },
    ],
  }
}

const CHANGE_OUTCOMES = {
  'too-many': 'You already have 20 characters. Delete one before adding another.',
  'bad-spec': "That class can't play that spec. Choose again.",
  'bad-character': 'That character is no longer yours to change.',
  ...LOOKUP_OUTCOMES,
}

/** The line above the list after adding, choosing a main or deleting. */
export function characterNotice(result, kind) {
  if (result?.outcome === 'saved') {
    if (kind === 'form') {
      const name = escapeDiscord(result.character.name)
      if (result.existing) return `You already have **${name}**.`
      return `Added **${name}**${result.character.main ? ' as your main' : ''}.`
    }
    const name = escapeDiscord(result.name)
    return result.action === 'main' ? `**${name}** is now your main.` : `Deleted **${name}**.`
  }
  if (result?.outcome === 'only-character')
    return `**${escapeDiscord(result.name)}** is your only character. Add another before deleting it.`
  return CHANGE_OUTCOMES[result?.outcome] ?? 'That change could not be saved. Try again in a moment.'
}
