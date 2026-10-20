/**
 * Discord slash commands and button presses on bot-posted rosters and sign-up posts. Pure handling shared by
 * the raid-interactions Edge Function and executable Vitest tests; storage and network calls are
 * injected.
 *
 * Identity comes only from the signed interaction: the Discord user, server, channel and message.
 * The database then checks that message belongs to the guild's current delivery and that the user
 * may answer (respond_to_discord_raid for rosters, signup_from_discord for sign-ups). Character setup
 * (/raid characters, and a sign-up press from a player with none) is in discord-characters.js.
 */

import { parseRaidCommand, raidCommandReply } from './discord-commands.js'
import { interactionJoinArgs } from './discord-join.js'
import {
  characterForm,
  characterListReply,
  characterNotice,
  deleteConfirmReply,
  firstCharacterReply,
  parseCharacterInteraction,
  signedPlayer,
  specMenuReply,
} from './discord-characters.js'
import {
  availabilityReply,
  availabilityResponse,
  parseAvailabilityInteraction,
} from './discord-availability.js'

const SNOWFLAKE = /^\d{17,20}$/
const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
const SIGNUP_STATUS = '(signed|late|tentative|absent)'
/** `wtr:<delivery id>:<delivery version>:<status>`, at most 100 characters as Discord requires. */
const CUSTOM_ID = new RegExp(`^wtr:${UUID}:(\\d{1,15}):(confirmed|tentative|unavailable)$`)
/** `wtb:<delivery id>:<post message id>:<version>` on a private standby character menu. */
const STANDBY_MENU_ID = new RegExp(`^wtb:${UUID}:(\\d{17,20}):(\\d{1,15})$`)
/** `wts:<delivery id>:<status>` on a sign-up post. Not versioned: every sign-up edits the post. */
const SIGNUP_BUTTON_ID = new RegExp(`^wts:${UUID}:${SIGNUP_STATUS}$`)
/** `wtc:<delivery id>:<post message id>:<status>` on the private character menu. */
const SIGNUP_MENU_ID = new RegExp(`^wtc:${UUID}:(\\d{17,20}):${SIGNUP_STATUS}$`)
/** `wtp:<delivery id>:<post message id>` on the private "Change spec" menu. */
const SIGNUP_SPEC_ID = new RegExp(`^wtp:${UUID}:(\\d{17,20})$`)
/** `wtv:<view>` on a sign-up post: open a player's characters or usual times privately. */
const PLAYER_VIEW_ID = /^wtv:(characters|availability)$/
/** A "Change spec" option's value: `<spec>|<role>`. */
const SPEC_VALUE = /^([^|]{1,40})\|(Tank|Healer|DPS)$/
/** Discord rejects replays older than this; so do we. */
const MAX_SKEW_MS = 5 * 60 * 1000

const PING = 1
const COMPONENT = 3
const PONG = 1
const DEFERRED_MESSAGE = 5
const DEFERRED_UPDATE = 6
const CHANNEL_MESSAGE = 4
const UPDATE_MESSAGE = 7
const MODAL = 9
const INVALID_FORM =
  'Enter a character name (up to 30 characters) and a realm (up to 60). Choose the spec again to retry.'
/** How long the character form waits for a realm to suggest before opening without one. */
const REALM_HINT_MS = 1500
const EPHEMERAL = 64
const BUTTON = 2
const STRING_SELECT = 3
const ACTION_ROW = 1
const STYLE_PRIMARY = 1
const STYLE_SECONDARY = 2
const STYLE_SUCCESS = 3
const STYLE_DANGER = 4
const STYLE_LINK = 5
/** Discord's limits for select menu options and their labels. */
const MAX_OPTIONS = 25
const MAX_LABEL = 100

/** Statuses as stored in raid_responses. */
export const RESPONSE_LABELS = { confirmed: 'Confirm', tentative: 'Tentative', unavailable: "Can't attend" }

function hexBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) return null
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}

/** Ed25519 over `timestamp + body`, exactly as received. Stale or malformed requests are rejected. */
export async function verifyDiscordSignature({ publicKey, signature, timestamp, body, now = Date.now() }) {
  const key = hexBytes(publicKey)
  const sig = hexBytes(signature)
  if (!key || key.length !== 32 || !sig || sig.length !== 64) return false
  if (!/^\d{1,12}$/.test(timestamp ?? '') || Math.abs(now - Number(timestamp) * 1000) > MAX_SKEW_MS)
    return false
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify('Ed25519', cryptoKey, sig, new TextEncoder().encode(timestamp + body))
  } catch {
    return false
  }
}

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Who pressed what, where: only from the signed interaction, on a message this application wrote. */
function signedContext(interaction, applicationId) {
  const userId = interaction.member?.user?.id
  const { guild_id: server, channel_id: channel, message } = interaction
  if (!SNOWFLAKE.test(server ?? '') || !SNOWFLAKE.test(userId ?? '') || !SNOWFLAKE.test(channel ?? ''))
    return null
  if (!SNOWFLAKE.test(message?.id ?? '') || message?.author?.id !== applicationId) return null
  if (!SNOWFLAKE.test(interaction.id ?? '')) return null
  return {
    p_interaction_id: interaction.id,
    p_discord_id: userId,
    p_discord_guild_id: server,
    p_channel_id: channel,
  }
}

/** The RPC arguments for a roster button pressed in a server channel, or null for anything else. */
export function parseRosterClick(interaction, applicationId) {
  const context = signedContext(interaction, applicationId)
  const { data } = interaction
  if (!context || data?.component_type !== BUTTON) return null
  const match = CUSTOM_ID.exec(data.custom_id ?? '')
  if (!match) return null
  return {
    ...context,
    p_message_id: interaction.message.id,
    p_delivery_id: match[1],
    p_version: Number(match[2]),
    p_status: match[3],
  }
}

/** A character chosen privately for an off-roster Confirm press. */
export function parseStandbyChoice(interaction, applicationId) {
  const context = signedContext(interaction, applicationId)
  const { data } = interaction
  if (!context || data?.component_type !== STRING_SELECT) return null
  const match = STANDBY_MENU_ID.exec(data.custom_id ?? '')
  const [characterId] = Array.isArray(data.values) && data.values.length === 1 ? data.values : []
  if (!match || typeof characterId !== 'string' || !/^.{1,64}$/.test(characterId)) return null
  return {
    ...context,
    p_message_id: match[2],
    p_delivery_id: match[1],
    p_version: Number(match[3]),
    p_status: 'confirmed',
    p_character_id: characterId,
  }
}

/**
 * The RPC arguments for a sign-up button on the post, or a character chosen from the private menu
 * (which names the post it came from), or null for anything else.
 */
export function parseSignup(interaction, applicationId) {
  const context = signedContext(interaction, applicationId)
  const { data } = interaction
  if (!context) return null
  if (data?.component_type === BUTTON) {
    const match = SIGNUP_BUTTON_ID.exec(data.custom_id ?? '')
    if (!match) return null
    return {
      ...context,
      p_message_id: interaction.message.id,
      p_delivery_id: match[1],
      p_status: match[2],
      p_character_id: null,
    }
  }
  if (data?.component_type === STRING_SELECT) {
    const match = SIGNUP_MENU_ID.exec(data.custom_id ?? '')
    const [characterId] = Array.isArray(data.values) && data.values.length === 1 ? data.values : []
    if (!match || typeof characterId !== 'string' || !/^.{1,64}$/.test(characterId)) return null
    return {
      ...context,
      p_message_id: match[2],
      p_delivery_id: match[1],
      p_status: match[3],
      p_character_id: characterId,
    }
  }
  return null
}

/** The RPC arguments for a spec chosen from the private "Change spec" menu, or null for anything else. */
export function parseSpecChange(interaction, applicationId) {
  const context = signedContext(interaction, applicationId)
  const { data } = interaction
  if (!context || data?.component_type !== STRING_SELECT) return null
  const match = SIGNUP_SPEC_ID.exec(data.custom_id ?? '')
  const [value] = Array.isArray(data.values) && data.values.length === 1 ? data.values : []
  const choice = typeof value === 'string' ? SPEC_VALUE.exec(value) : null
  if (!match || !choice) return null
  return {
    ...context,
    p_message_id: match[2],
    p_delivery_id: match[1],
    p_spec: choice[1],
    p_role: choice[2],
  }
}

const OUTCOME_MESSAGES = {
  'not-member': 'Your Discord account is not a member of this guild in WhenToRaid.',
  'not-rostered': 'You are not on this published roster. Confirm to offer yourself as a backup.',
  stale: 'This roster just changed. Use the updated post, or open the roster in WhenToRaid.',
  duplicate: 'That press was already recorded.',
  closed: 'This raid has started, was cancelled, or is no longer published.',
  unknown: 'This post is no longer connected to a WhenToRaid roster.',
}

/** The private reply for an outcome returned by respond_to_discord_raid. */
export function outcomeMessage(result) {
  if (result?.outcome === 'standby')
    return `You offered to fill a place in ${result.raidName || 'this raid'} as ${result.character}. Your officers can see you as a backup; you are not on the published roster yet.`
  if (result?.outcome === 'saved') {
    const raid = result.raidName ? ` for ${result.raidName}` : ''
    if (result.status === 'tentative')
      return `You're marked tentative${raid}. Your officers can see you're unsure. Confirm when you know.`
    return result.status === 'confirmed'
      ? `You confirmed your place${raid}. Thanks!`
      : `Your officers can see you can't attend${raid}.`
  }
  return OUTCOME_MESSAGES[result?.outcome] ?? 'Your response could not be saved. Try again in WhenToRaid.'
}

function charactersLink(appUrl, guildId) {
  if (!appUrl) return null
  const base = new URL(appUrl)
  if (base.protocol !== 'https:') return null
  return `${base.origin}${base.pathname}${guildId ? `?guild=${guildId}` : ''}#/characters`
}

function onboardingReply(content, appUrl, guildId) {
  const url = charactersLink(appUrl, guildId)
  return {
    content,
    components: url
      ? [
          {
            type: ACTION_ROW,
            components: [{ type: BUTTON, style: STYLE_LINK, label: 'Set up characters', url }],
          },
        ]
      : [],
  }
}

export function rosterReply(result, args = {}, appUrl) {
  if (result?.outcome === 'choose') {
    const options = (result.characters ?? []).slice(0, MAX_OPTIONS).map((c) => ({
      label: `${c.name} — ${[c.spec, c.class].filter(Boolean).join(' ')}`.slice(0, MAX_LABEL),
      value: c.id,
      ...(c.role ? { description: c.role } : {}),
    }))
    return {
      content: 'You are not on the published roster. Which character could you bring as a backup?',
      components: [
        {
          type: ACTION_ROW,
          components: [
            {
              type: STRING_SELECT,
              custom_id: `wtb:${args.p_delivery_id}:${args.p_message_id}:${args.p_version}`,
              placeholder: 'Choose a backup character',
              options,
            },
          ],
        },
      ],
    }
  }
  if (result?.outcome === 'no-characters')
    return onboardingReply(
      'Add a character in WhenToRaid, then press Confirm again. Sign in with this Discord account; your guild will appear automatically.',
      appUrl,
      result.guildId,
    )
  if (result?.outcome === 'not-member')
    return onboardingReply(
      'Sign in to WhenToRaid with this Discord account, then return and press Confirm again. If your guild is missing, ask an officer for an invite.',
      appUrl,
      result.guildId,
    )
  if (result?.outcome === 'bad-character')
    return {
      content: 'That character is no longer available. Press Confirm again to choose another.',
      components: [],
    }
  return outcomeMessage(result)
}

const SIGNUP_OUTCOMES = {
  'no-characters': 'Add a character in WhenToRaid first, then press Sign up again.',
  'bad-character': 'That character is not one of yours any more. Press Sign up again.',
  closed: 'Sign-ups for this raid are closed: it has started or was cancelled.',
  duplicate: 'That press was already recorded.',
  unknown: 'This post is no longer connected to a WhenToRaid raid.',
  'not-signed': 'Sign up first, then change your spec.',
  'bad-spec': "That character can't play that spec. Choose another.",
}

const BENCH_ROLES = { Tank: 'tank', Healer: 'healer', DPS: 'DPS' }

function savedSignup({ status, raidName, character, class: className, spec, role, afterDeadline, standing }) {
  const raid = raidName || 'this raid'
  const details = [[spec, className].filter(Boolean).join(' '), role].filter(Boolean).join(', ')
  const as = character ? ` as ${character}${details ? ` (${details})` : ''}` : ''
  const text = {
    signed: `You're signed up for ${raid}${as}.`,
    late: `You're signed up for ${raid}${as}, arriving late.`,
    tentative: `You're down as tentative for ${raid}${as}.`,
    absent: `You're marked absent for ${raid}. Thanks for letting your officers know.`,
  }[status]
  if (!text) return null
  const parts = [text]
  if (standing?.bench && (status === 'signed' || status === 'late'))
    parts.push(
      `The ${BENCH_ROLES[standing.role] ?? 'role'} spots are full, so you're on the bench. Your officers decide who plays.`,
    )
  if (afterDeadline)
    parts.push('The check-in deadline has passed, so your officers will see this as a late change.')
  return parts.join(' ')
}

/** The "Change spec" menu under a confirmation, bound to the post; the spec in use is preselected. */
function specMenu(result, args) {
  if (result.status === 'absent' || !result.character || !result.specs?.length) return []
  const options = result.specs.slice(0, MAX_OPTIONS).map(({ spec, role }) => ({
    label: `${spec} · ${role}`.slice(0, MAX_LABEL),
    value: `${spec}|${role}`,
    ...(spec === result.spec && role === result.role ? { default: true } : {}),
  }))
  return [
    {
      type: ACTION_ROW,
      components: [
        {
          type: STRING_SELECT,
          custom_id: `wtp:${args.p_delivery_id}:${args.p_message_id}`,
          placeholder: 'Change spec for this raid',
          options,
        },
      ],
    },
  ]
}

/**
 * The private reply to a sign-up press: a confirmation (with a "Change spec" menu), an explanation,
 * or (`choose`) a menu of the player's characters bound to the post that was pressed. `components`
 * is always set, so choosing from a menu replaces it.
 */
export function signupReply(result, args = {}, appUrl) {
  if (result?.outcome === 'choose') {
    const options = (result.characters ?? []).slice(0, MAX_OPTIONS).map((c) => ({
      label: `${c.name} — ${[c.spec, c.class].filter(Boolean).join(' ')}`.slice(0, MAX_LABEL),
      value: c.id,
      ...(c.role ? { description: c.role } : {}),
    }))
    return {
      content: 'Which character are you bringing?',
      components: [
        {
          type: ACTION_ROW,
          components: [
            {
              type: STRING_SELECT,
              custom_id: `wtc:${args.p_delivery_id}:${args.p_message_id}:${result.status}`,
              placeholder: 'Choose a character',
              options,
            },
          ],
        },
      ],
    }
  }
  if (result?.outcome === 'not-member') {
    const guild = result.guildName ? ` in ${result.guildName}` : ''
    return onboardingReply(
      `Your Discord account isn't a member${guild} on WhenToRaid yet. Sign in with this Discord account; if the guild is missing, ask an officer for an invite.`,
      appUrl,
      result.guildId,
    )
  }
  if (result?.outcome === 'no-characters') {
    // Set the character up right here; the website stays available as a link.
    if (args.p_delivery_id && args.p_message_id && args.p_status)
      return firstCharacterReply(args, charactersLink(appUrl, result.guildId))
    return onboardingReply(
      'Add a character in WhenToRaid, then press Sign up again. Sign in with this Discord account.',
      appUrl,
      result.guildId,
    )
  }
  const saved = result?.outcome === 'saved' && savedSignup(result)
  if (saved) return { content: saved, components: specMenu(result, args) }
  const content =
    SIGNUP_OUTCOMES[result?.outcome] || 'Your sign-up could not be saved. Try again in a moment.'
  return { content, components: [] }
}

/**
 * Edit the deferred reply through the interaction's own webhook (no bot token needed): the private
 * "thinking" message, or for a menu choice the private menu itself. `message` is text, or
 * `{ content, components }`.
 */
export async function editOriginalResponse(interaction, message, fetchFn = fetch) {
  const url = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`
  const body = typeof message === 'string' ? { content: message } : message
  const response = await fetchFn(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
  })
  if (!response.ok) throw new Error(`Discord returned ${response.status} for the interaction reply.`)
}

/**
 * `rpc`, after first joining the interaction's sender to the guilds linked to its server, so anyone
 * in the server can use the bot. The join runs once per interaction; if it fails, the call still
 * runs and answers as before.
 */
function rpcAsServerMember(interaction, rpc, log) {
  let joined
  const join = async () => {
    const args = interactionJoinArgs(interaction)
    if (!args) return
    try {
      await rpc('join_from_discord', args)
    } catch (error) {
      log(`interaction ${interaction.id} join failed: ${error.message}`)
    }
  }
  return async (name, args) => {
    await (joined ??= join())
    return rpc(name, args)
  }
}

/**
 * Handle one interaction request. Valid presses are acknowledged at once (Discord allows three
 * seconds) with a private "thinking" reply, or for a menu choice by updating that menu later;
 * `schedule` keeps the save, the follow-up and the post refresh running.
 * @param {Request} request
 * @param {{ publicKey: string, applicationId: string, appUrl?: string, now?: number,
 *   rpc: (name: string, args: object) => Promise<object>,
 *   followup?: (interaction: object, message: string | object) => Promise<void>,
 *   refresh?: (guildId: string) => Promise<unknown>,
 *   schedule: (work: Promise<unknown>) => void,
 *   log?: (message: string) => void }} config
 */
export async function handleDiscordInteraction(request, config) {
  const { publicKey, applicationId, now = Date.now(), schedule } = config
  const followup = config.followup ?? editOriginalResponse
  const log = config.log ?? (() => {})
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
  const body = await request.text()
  const verified = await verifyDiscordSignature({
    publicKey,
    signature: request.headers.get('x-signature-ed25519'),
    timestamp: request.headers.get('x-signature-timestamp'),
    body,
    now,
  })
  if (!verified) return reply({ error: 'Invalid request signature.' }, 401)

  let interaction
  try {
    interaction = JSON.parse(body)
  } catch {
    return reply({ error: 'Malformed interaction.' }, 400)
  }
  if (interaction?.application_id !== applicationId) return reply({ error: 'Wrong application.' }, 401)
  if (interaction.type === PING) return reply({ type: PONG })
  const rpc = rpcAsServerMember(interaction, config.rpc, log)
  const command = parseRaidCommand(interaction) ?? parsePlayerView(interaction, applicationId)
  if (command) {
    schedule(
      (async () => {
        let message
        try {
          if (command.name === 'characters')
            message = characterListReply(await rpc('discord_characters', command.args))
          else if (command.name === 'availability')
            message = availabilityReply(await rpc('discord_availability', command.args))
          else {
            const data = command.name === 'help' ? null : await rpc('discord_raid_overview', command.args)
            message = raidCommandReply(command, data, config.appUrl)
          }
        } catch (error) {
          log(`command ${interaction.id} failed: ${error.message}`)
          message = {
            content: 'Raids could not be loaded. Try again in a moment.',
            embeds: [],
            components: [],
          }
        }
        try {
          await followup(interaction, message)
        } catch (error) {
          log(`command ${interaction.id} reply failed: ${error.message}`)
        }
      })(),
    )
    return reply({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } })
  }
  const character = parseCharacterInteraction(interaction, applicationId)
  if (character)
    return handleCharacter(interaction, character, { ...config, lookup: config.rpc, rpc, followup, log })
  const availability = parseAvailabilityInteraction(interaction, applicationId)
  if (availability)
    return reply(availabilityResponse(interaction, availability, { ...config, rpc, followup, log }))
  if (interaction.type !== COMPONENT) return reply({ error: 'Unsupported interaction.' }, 400)
  const signup = parseSignup(interaction, applicationId)
  if (signup)
    return handleSignup(interaction, 'signup_from_discord', signup, { ...config, rpc, followup, log })
  const specChange = parseSpecChange(interaction, applicationId)
  if (specChange)
    return handleSignup(interaction, 'signup_spec_from_discord', specChange, {
      ...config,
      rpc,
      followup,
      log,
    })
  const args = parseRosterClick(interaction, applicationId) ?? parseStandbyChoice(interaction, applicationId)
  if (!args) return reply({ error: 'Unsupported interaction.' }, 400)

  schedule(
    (async () => {
      let result = null
      try {
        result = await rpc('respond_to_discord_raid', args)
      } catch (error) {
        log(`interaction ${interaction.id} failed: ${error.message}`)
      }
      try {
        const message = rosterReply(result, args, config.appUrl)
        await followup(
          interaction,
          interaction.data.component_type === STRING_SELECT && typeof message === 'string'
            ? { content: message, components: [] }
            : message,
        )
      } catch (error) {
        log(`interaction ${interaction.id} reply failed: ${error.message}`)
      }
      if ((result?.outcome === 'saved' || result?.outcome === 'standby') && config.refresh)
        try {
          await config.refresh(result.guildId)
        } catch (error) {
          log(`interaction ${interaction.id} post refresh failed: ${error.message}`)
        }
    })(),
  )
  return reply(
    interaction.data.component_type === STRING_SELECT
      ? { type: DEFERRED_UPDATE }
      : { type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } },
  )
}

/** Save a sign-up (or its spec), answer the player privately, then bring the public post up to date. */
function handleSignup(interaction, rpcName, args, config) {
  config.schedule(saveSignup(interaction, rpcName, args, config))
  // A choice from the private menu updates that menu; a press on the post gets its own private reply.
  const fromMenu = interaction.data.component_type === STRING_SELECT
  return reply(fromMenu ? { type: DEFERRED_UPDATE } : { type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } })
}

/** The work behind handleSignup. `notice` leads the private reply (a character just added). */
async function saveSignup(interaction, rpcName, args, { rpc, followup, refresh, log, appUrl }, notice) {
  let result = null
  try {
    result = await rpc(rpcName, args)
  } catch (error) {
    log(`sign-up ${interaction.id} failed: ${error.message}`)
  }
  if (result?.outcome === 'saved' && (result.status === 'signed' || result.status === 'late')) {
    try {
      const standing = await rpc('signup_standing', {
        p_delivery_id: args.p_delivery_id,
        p_discord_id: args.p_discord_id,
      })
      result = { ...result, standing }
    } catch (error) {
      // The sign-up is saved; only the bench notice is missing.
      log(`sign-up ${interaction.id} standing failed: ${error.message}`)
    }
  }
  try {
    const message = signupReply(result, args, appUrl)
    await followup(interaction, notice ? { ...message, content: `${notice}\n${message.content}` } : message)
  } catch (error) {
    log(`sign-up ${interaction.id} reply failed: ${error.message}`)
  }
  if (result?.outcome !== 'saved' || !refresh) return
  try {
    await refresh(result.guildId)
  } catch (error) {
    // The post is queued either way; the scheduler sends it within minutes.
    log(`sign-up ${interaction.id} post refresh failed: ${error.message}`)
  }
}

/**
 * Character setup steps. Choosing a class or asking to delete answers at once by replacing the private
 * message; choosing a spec opens the name form. Saving (the form, a main, a delete) is acknowledged
 * and then the private message is replaced with the result: the sign-up it finished, or the list.
 */
function handleCharacter(interaction, action, config) {
  if (action.kind === 'class') return reply({ type: UPDATE_MESSAGE, data: specMenuReply(action) })
  if (action.kind === 'remove') return reply({ type: UPDATE_MESSAGE, data: deleteConfirmReply(action) })
  if (action.kind === 'spec') return characterFormResponse(action, config)
  if (action.kind === 'form-invalid')
    return reply({ type: CHANNEL_MESSAGE, data: { content: INVALID_FORM, flags: EPHEMERAL } })
  config.schedule(
    (async () => {
      let message
      try {
        message = await saveCharacterChange(interaction, action, config)
      } catch (error) {
        config.log(`character ${interaction.id} failed: ${error.message}`)
        message = { content: 'That change could not be saved. Try again in a moment.', components: [] }
      }
      if (!message) return
      try {
        await config.followup(interaction, message)
      } catch (error) {
        config.log(`character ${interaction.id} reply failed: ${error.message}`)
      }
    })(),
  )
  return reply({ type: DEFERRED_UPDATE })
}

/**
 * The name form, with the realm the player most likely plays on when it can be found quickly. The
 * form must answer the interaction itself, so this skips the join (`lookup` is the plain call): the
 * player joined when their first press reached the bot.
 */
async function characterFormResponse(action, { lookup, log }) {
  let timer
  let realm = null
  try {
    const data = await Promise.race([
      lookup('discord_characters', action.who),
      new Promise((resolve) => {
        timer = setTimeout(resolve, REALM_HINT_MS, null)
      }),
    ])
    realm = data?.realm ?? null
  } catch (error) {
    log(`character form realm failed: ${error.message}`)
  } finally {
    clearTimeout(timer)
  }
  return reply({ type: MODAL, data: characterForm(action, realm) })
}

/**
 * Add, choose a main or delete, then the reply. A character added from a sign-up press signs the
 * player up with it (that reply is sent by saveSignup, so this returns null).
 */
async function saveCharacterChange(interaction, action, config) {
  const { rpc } = config
  let notice
  if (action.kind === 'form') {
    const { className, spec, role } = action.choice
    const result = await rpc('add_character_from_discord', {
      ...action.who,
      p_name: action.name,
      p_realm: action.realm,
      p_class: className,
      p_spec: spec,
      p_role: role,
    })
    notice = characterNotice(result, 'form')
    if (action.signup) {
      if (result?.outcome !== 'saved') return { content: notice, components: [] }
      const args = {
        p_interaction_id: action.interactionId,
        ...action.who,
        ...action.signup,
        p_character_id: result.character.id,
      }
      await saveSignup(interaction, 'signup_from_discord', args, config, notice)
      return null
    }
  } else if (action.kind === 'main' || action.kind === 'delete') {
    const result = await rpc('manage_character_from_discord', {
      ...action.who,
      p_character_id: action.characterId,
      p_action: action.kind === 'main' ? 'main' : 'retire',
    })
    notice = characterNotice(result, action.kind)
  }
  try {
    return characterListReply(await rpc('discord_characters', action.who), notice)
  } catch (error) {
    // The change itself went through; only the refreshed list is missing.
    config.log(`character ${interaction.id} list failed: ${error.message}`)
    return { content: notice, components: [] }
  }
}

/** The app page where a player sees the week they are signing up for. */
function weekLink(appUrl, job) {
  const base = new URL(appUrl)
  if (base.protocol !== 'https:') throw new Error('The app address must use HTTPS.')
  return `${base.origin}${base.pathname}?guild=${job.guild_id}#/availability/${job.week}`
}

/**
 * Buttons for a sign-up post: Sign up, Late, Tentative, Absent and a link to the week in the app,
 * then My characters and My availability. A raid that started or was cancelled gets none.
 */
export function signupComponents(job, payload, appUrl) {
  if (payload?.closed || payload?.cancelled) return []
  const link = weekLink(appUrl, job)
  const button = (status, label, emoji, style) => ({
    type: BUTTON,
    style,
    label,
    emoji: { name: emoji },
    custom_id: `wts:${job.id}:${status}`,
  })
  return [
    {
      type: ACTION_ROW,
      components: [
        button('signed', 'Sign up', '✅', STYLE_SUCCESS),
        button('late', 'Late', '⏰', STYLE_PRIMARY),
        button('tentative', 'Tentative', '❔', STYLE_SECONDARY),
        button('absent', 'Absent', '❌', STYLE_DANGER),
        { type: BUTTON, style: STYLE_LINK, label: 'Open in WhenToRaid', url: link },
      ],
    },
    playerViewRow(),
  ]
}

/** The second row on sign-up and roster posts: My characters and My availability. */
function playerViewRow() {
  const button = (view, label, emoji) => ({
    type: BUTTON,
    style: STYLE_SECONDARY,
    label,
    emoji: { name: emoji },
    custom_id: `wtv:${view}`,
  })
  return {
    type: ACTION_ROW,
    components: [
      button('characters', 'My characters', '👤'),
      button('availability', 'My availability', '📅'),
    ],
  }
}

/**
 * My characters / My availability on a sign-up or roster post: the same private reply as
 * /raid characters and /raid availability, so players need not type a command. Identity comes from
 * the signed press.
 */
export function parsePlayerView(interaction, applicationId) {
  if (interaction.type !== COMPONENT || interaction.data?.component_type !== BUTTON) return null
  const match = PLAYER_VIEW_ID.exec(interaction.data.custom_id ?? '')
  const args = match && signedPlayer(interaction, applicationId)
  return args ? { name: match[1], args } : null
}

/**
 * Buttons for a bot-posted roster: respond, and open the published roster, then My characters and
 * My availability. The response buttons are bound to the delivery version, so presses on an
 * outdated post are refused rather than applied to a changed roster. Cancelled and withdrawn rosters
 * get no buttons.
 */
export function rosterComponents(job, appUrl) {
  const base = new URL(appUrl)
  if (base.protocol !== 'https:') throw new Error('The app address must use HTTPS.')
  if (job.payload?.cancelled || job.payload?.withdrawn) return []
  const button = (status, style) => ({
    type: BUTTON,
    style,
    label: RESPONSE_LABELS[status],
    custom_id: `wtr:${job.id}:${job.version}:${status}`,
  })
  const link = `${base.origin}${base.pathname}?guild=${job.guild_id}#/published/${job.week}/${job.raid_id}`
  return [
    {
      type: ACTION_ROW,
      components: [
        button('confirmed', STYLE_SUCCESS),
        button('tentative', STYLE_SECONDARY),
        button('unavailable', STYLE_DANGER),
        { type: BUTTON, style: STYLE_LINK, label: 'View roster', url: link },
      ],
    },
    playerViewRow(),
  ]
}
