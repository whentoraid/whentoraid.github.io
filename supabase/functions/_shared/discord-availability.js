/**
 * /raid availability: the player's usual raid times, set in Discord. The private reply lists them
 * per day and offers a days menu, From and Until menus (on the hour, inside the guild's planning
 * hours) and two buttons: available these times, or not available these days. Saving changes only
 * the days picked. The picks so far ride in the controls' ids, so choosing from a menu needs no
 * database call; only saving does. Pure parsing and replies; the raid-interactions handler makes
 * the calls.
 */
import { escapeDiscord } from './raid-service-core.js'
import { LOOKUP_OUTCOMES, signedPlayer } from './discord-characters.js'

/** `wa<control>:<day start hour>:<slots per day>:<days bitmask, Monday = 1>:<from slot|->:<until slot|->` */
const CONTROL_ID = /^wa([dftsn]):(\d{1,2}):(\d{1,2}):(\d{1,3}):(\d{1,2}|-):(\d{1,2}|-)$/
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ALL_DAYS = 127

const COMPONENT = 3
const DEFERRED_UPDATE = 6
const UPDATE_MESSAGE = 7
const ACTION_ROW = 1
const BUTTON = 2
const STRING_SELECT = 3
const STYLE_SUCCESS = 3
const STYLE_SECONDARY = 2

const EMPTY = { mask: 0, from: null, to: null }

const daysIn = (mask) => DAYS.flatMap((_, day) => (mask & (1 << day) ? [day] : []))
const slotOrNull = (text) => (text === '-' ? null : Number(text))

/** "7 PM", "7:30 PM", "12 AM": the wall-clock time `slot` half-hours after the day starts. */
export function slotLabel(dayStartHour, slot) {
  const minutes = (dayStartHour * 60 + slot * 30) % (24 * 60)
  const hour = Math.floor(minutes / 60)
  const half = minutes % 60 ? ':30' : ''
  return `${hour % 12 || 12}${half} ${hour < 12 ? 'AM' : 'PM'}`
}

/**
 * The menu choices, on the hour: From offers each hour that starts inside the day; Until each hour
 * after the start, and the day's end when it falls on a half hour.
 */
function menuSlots(slotsPerDay, control) {
  const slots = []
  if (control === 'f') for (let slot = 0; slot < slotsPerDay; slot += 2) slots.push(slot)
  else {
    for (let slot = 2; slot <= slotsPerDay; slot += 2) slots.push(slot)
    if (slots.at(-1) !== slotsPerDay) slots.push(slotsPerDay)
  }
  return slots
}

function parseGrid(match) {
  const grid = { dayStartHour: Number(match[2]), slotsPerDay: Number(match[3]) }
  const state = { mask: Number(match[4]), from: slotOrNull(match[5]), to: slotOrNull(match[6]) }
  const { slotsPerDay } = grid
  const fits = (slot, low, high) => slot === null || (slot >= low && slot <= high)
  const valid =
    grid.dayStartHour <= 23 &&
    slotsPerDay >= 1 &&
    slotsPerDay <= 48 &&
    state.mask <= ALL_DAYS &&
    fits(state.from, 0, slotsPerDay - 1) &&
    fits(state.to, 1, slotsPerDay)
  return valid ? { grid, state } : null
}

/** The new picks after a menu choice, or null when the choice is not one the menu offered. */
function pick(control, values, grid, state) {
  if (control === 'd') {
    const days = values.map(Number)
    if (days.length > 7 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null
    return { ...state, mask: days.reduce((mask, day) => mask | (1 << day), 0) }
  }
  const slot = values.length === 1 && /^\d{1,2}$/.test(values[0]) ? Number(values[0]) : null
  if (slot === null || !menuSlots(grid.slotsPerDay, control).includes(slot)) return null
  return control === 'f' ? { ...state, from: slot } : { ...state, to: slot }
}

/**
 * A menu choice or button on the availability reply, or null for anything else.
 * @returns {null | { kind: 'edit' | 'save', who: object, grid: { dayStartHour: number, slotsPerDay: number },
 *   state: { mask: number, from: number | null, to: number | null }, available?: boolean }}
 */
export function parseAvailabilityInteraction(interaction, applicationId) {
  const who = signedPlayer(interaction, applicationId)
  const { data } = interaction
  if (!who || interaction.type !== COMPONENT || typeof data?.custom_id !== 'string') return null
  const match = CONTROL_ID.exec(data.custom_id)
  const parsed = match && parseGrid(match)
  if (!parsed) return null
  const { grid } = parsed
  const control = match[1]
  if (control === 'd' || control === 'f' || control === 't') {
    if (data.component_type !== STRING_SELECT || !Array.isArray(data.values)) return null
    const state = pick(control, data.values, grid, parsed.state)
    return state && { kind: 'edit', who, grid, state }
  }
  const { state } = parsed
  if (data.component_type !== BUTTON || !state.mask) return null
  if (control === 'n') return { kind: 'save', who, grid, state, available: false }
  if (state.from === null || state.to === null || state.to <= state.from) return null
  return { kind: 'save', who, grid, state, available: true }
}

/** The menus and buttons, with the picks so far shown and carried in their ids. */
export function availabilityControls({ dayStartHour, slotsPerDay }, state = EMPTY) {
  const id = (control) =>
    `wa${control}:${dayStartHour}:${slotsPerDay}:${state.mask}:${state.from ?? '-'}:${state.to ?? '-'}`
  const timeMenu = (control, placeholder, chosen) => ({
    type: ACTION_ROW,
    components: [
      {
        type: STRING_SELECT,
        custom_id: id(control),
        placeholder,
        options: menuSlots(slotsPerDay, control).map((slot) => ({
          label: slotLabel(dayStartHour, slot),
          value: String(slot),
          ...(slot === chosen ? { default: true } : {}),
        })),
      },
    ],
  })
  const canSave = state.mask > 0 && state.from !== null && state.to !== null && state.to > state.from
  return [
    {
      type: ACTION_ROW,
      components: [
        {
          type: STRING_SELECT,
          custom_id: id('d'),
          placeholder: 'Choose days',
          min_values: 0,
          max_values: 7,
          options: DAYS.map((label, day) => ({
            label,
            value: String(day),
            ...(state.mask & (1 << day) ? { default: true } : {}),
          })),
        },
      ],
    },
    timeMenu('f', 'From', state.from),
    timeMenu('t', 'Until', state.to),
    {
      type: ACTION_ROW,
      components: [
        {
          type: BUTTON,
          style: STYLE_SUCCESS,
          label: 'Available these times',
          custom_id: id('s'),
          disabled: !canSave,
        },
        {
          type: BUTTON,
          style: STYLE_SECONDARY,
          label: 'Not available these days',
          custom_id: id('n'),
          disabled: !state.mask,
        },
      ],
    },
  ]
}

/** One line per day: its windows ("Tue: 7 PM – 11 PM"), or "not available". */
function dayLines({ dayStartHour, slotsPerDay, slots = [] }) {
  const cells = new Set(slots)
  return DAYS.map((label, day) => {
    const windows = []
    for (let slot = 0; slot < slotsPerDay; slot++) {
      if (!cells.has(day * slotsPerDay + slot)) continue
      const last = windows.at(-1)
      if (last?.to === slot) windows[windows.length - 1] = { ...last, to: slot + 1 }
      else windows.push({ from: slot, to: slot + 1 })
    }
    const text = windows.length
      ? windows
          .map(({ from, to }) => `${slotLabel(dayStartHour, from)} – ${slotLabel(dayStartHour, to)}`)
          .join(', ')
      : 'not available'
    return `${label}: ${text}`
  })
}

/** The private /raid availability reply: the usual times, notes, and the controls. */
export function availabilityReply(data, notice) {
  if (data?.outcome !== 'ok' && data?.outcome !== 'saved')
    return {
      content:
        LOOKUP_OUTCOMES[data?.outcome] ?? 'Your raid times could not be loaded. Try again in a moment.',
      embeds: [],
      components: [],
    }
  const guild = data.guildName ? ` in ${escapeDiscord(data.guildName)}` : ''
  const lines = [notice, `**Your usual raid times**${guild} · guild time (${escapeDiscord(data.timezone)})`]
  if (data.gridChanged)
    lines.push("Your usual times were saved before the guild's planning hours changed. Set them again below.")
  else if (!data.hasSchedule)
    lines.push("You haven't set usual times yet. Officers plan raid times around them.")
  else {
    lines.push(...dayLines(data))
    if (data.paused) lines.push('Your usual schedule is paused. Saving here starts it again.')
  }
  if (data.weekAnswered)
    lines.push(`You've already answered the week of ${data.week}, so changes fill in the weeks after it.`)
  lines.push('Pick days and times below, then save. Only the days you pick change.')
  return {
    content: lines.filter(Boolean).join('\n'),
    embeds: [],
    components: availabilityControls(data),
  }
}

/** The line above the refreshed reply after saving. */
function savedNotice({ grid, state, available }) {
  const days = daysIn(state.mask)
    .map((day) => DAYS[day])
    .join(', ')
  if (!available) return `Saved: not available on ${days}.`
  const from = slotLabel(grid.dayStartHour, state.from)
  const to = slotLabel(grid.dayStartHour, state.to)
  return `Saved: ${days} available ${from} – ${to}.`
}

/** The arguments set_availability_from_discord takes for a save. */
function saveArgs({ who, grid, state, available }) {
  return {
    ...who,
    p_days: daysIn(state.mask),
    p_from: available ? state.from : null,
    p_to: available ? state.to : null,
    p_available: available,
    p_day_start_hour: grid.dayStartHour,
    p_slots_per_day: grid.slotsPerDay,
  }
}

/**
 * The interaction response for a control. A menu choice only redraws the controls (the summary
 * stays); saving is acknowledged, then `followup` replaces the reply with the updated times. A save
 * that fails keeps the controls and picks, so the player can try again.
 */
export function availabilityResponse(interaction, action, { rpc, schedule, followup, log }) {
  if (action.kind === 'edit')
    return { type: UPDATE_MESSAGE, data: { components: availabilityControls(action.grid, action.state) } }
  schedule(
    (async () => {
      let message
      try {
        const result = await rpc('set_availability_from_discord', saveArgs(action))
        message =
          result?.outcome === 'stale'
            ? availabilityReply(
                await rpc('discord_availability', action.who),
                'Your guild changed its planning hours, so nothing was saved. Choose again.',
              )
            : availabilityReply(result, savedNotice(action))
      } catch (error) {
        log(`availability ${interaction.id} failed: ${error.message}`)
        message = {
          content: 'Your times could not be saved. Try again in a moment.',
          components: availabilityControls(action.grid, action.state),
        }
      }
      try {
        await followup(interaction, message)
      } catch (error) {
        log(`availability ${interaction.id} reply failed: ${error.message}`)
      }
    })(),
  )
  return { type: DEFERRED_UPDATE }
}
