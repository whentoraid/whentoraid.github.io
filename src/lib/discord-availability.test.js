// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { handleDiscordInteraction } from '../../supabase/functions/_shared/discord-interactions.js'
import { availabilityReply, slotLabel } from '../../supabase/functions/_shared/discord-availability.js'

const APP = '123456789012345678'
const USER = '223456789012345678'
const CHANNEL = '323456789012345678'
const SERVER = '423456789012345678'
const PRIVATE = '533456789012345678'
const NOW = 1792000000000
const WHO = { p_discord_id: USER, p_discord_guild_id: SERVER, p_channel_id: CHANNEL }

let keys, publicKey
const hex = (bytes) => Buffer.from(bytes).toString('hex')
beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  publicKey = hex(await webcrypto.subtle.exportKey('raw', keys.publicKey))
})
async function signed(body) {
  const raw = JSON.stringify(body)
  const timestamp = String(NOW / 1000)
  const signature = hex(
    await webcrypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + raw)),
  )
  return new Request('https://test/functions/v1/raid-interactions', {
    method: 'POST',
    body: raw,
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
  })
}

const BOT_MESSAGE = { id: PRIVATE, author: { id: APP, bot: true } }
const base = (type, data, message = BOT_MESSAGE) => ({
  id: '623456789012345679',
  application_id: APP,
  type,
  token: 'valid_interaction_token',
  guild_id: SERVER,
  channel_id: CHANNEL,
  member: { user: { id: USER } },
  message,
  data,
})
const select = (custom_id, values) => base(3, { component_type: 3, custom_id, values })
const button = (custom_id, message) => base(3, { component_type: 2, custom_id }, message)
const command = () => ({
  ...base(2, { type: 1, name: 'raid', options: [{ type: 1, name: 'availability' }] }),
  message: undefined,
})

/** Guild hours 5 PM to midnight: 14 half-hour slots from 17:00. */
const GRID = { dayStartHour: 17, slotsPerDay: 14 }
/** Tuesday (day 1) 7 PM to 11 PM: slots 4 through 11. */
const TUESDAY_EVENING = Array.from({ length: 8 }, (_, i) => 14 + 4 + i)
const schedule = (overrides = {}) => ({
  outcome: 'ok',
  guildName: 'Untitled Guild',
  timezone: 'America/Chicago',
  ...GRID,
  week: '2026-10-19',
  hasSchedule: true,
  gridChanged: false,
  paused: false,
  slots: TUESDAY_EVENING,
  weekAnswered: false,
  ...overrides,
})
const ids = (components) => components.flatMap((row) => row.components.map((c) => c.custom_id))
const options = (components, row) => components[row].components[0].options

async function run(payload, results = {}) {
  const work = []
  const rpc = vi.fn(async (name) => (typeof results[name] === 'function' ? results[name]() : results[name]))
  const followup = vi.fn()
  const response = await handleDiscordInteraction(await signed(payload), {
    publicKey,
    applicationId: APP,
    now: NOW,
    rpc,
    followup,
    schedule: (promise) => work.push(promise),
  })
  await Promise.all(work)
  const calls = (name) => rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args)
  return { response, body: await response.json(), rpc, calls, followup }
}

describe('/raid availability', () => {
  it('labels guild times on a 12-hour clock', () => {
    expect(slotLabel(17, 0)).toBe('5 PM')
    expect(slotLabel(17, 1)).toBe('5:30 PM')
    expect(slotLabel(17, 14)).toBe('12 AM')
    expect(slotLabel(0, 0)).toBe('12 AM')
    expect(slotLabel(11, 2)).toBe('12 PM')
  })

  it('shows the usual times per day with menus inside the guild hours', async () => {
    const { body, calls, followup } = await run(command(), { discord_availability: schedule() })
    expect(body).toEqual({ type: 5, data: { flags: 64 } })
    expect(calls('discord_availability')).toEqual([WHO])
    const message = followup.mock.calls[0][1]
    expect(message.content.split('\n')).toEqual([
      '**Your usual raid times** in Untitled Guild · guild time (America/Chicago)',
      'Mon: not available',
      'Tue: 7 PM – 11 PM',
      'Wed: not available',
      'Thu: not available',
      'Fri: not available',
      'Sat: not available',
      'Sun: not available',
      'Pick days and times below, then save. Only the days you pick change.',
    ])
    expect(ids(message.components)).toEqual([
      'wad:17:14:0:-:-',
      'waf:17:14:0:-:-',
      'wat:17:14:0:-:-',
      'was:17:14:0:-:-',
      'wan:17:14:0:-:-',
    ])
    expect(options(message.components, 1).map((o) => o.label)).toEqual([
      '5 PM',
      '6 PM',
      '7 PM',
      '8 PM',
      '9 PM',
      '10 PM',
      '11 PM',
    ])
    expect(options(message.components, 2).map((o) => o.label)).toEqual([
      '6 PM',
      '7 PM',
      '8 PM',
      '9 PM',
      '10 PM',
      '11 PM',
      '12 AM',
    ])
    expect(message.components[3].components.map((b) => b.disabled)).toEqual([true, true])
  })

  it('lists separate windows, and explains a missing, paused, re-houred or answered schedule', () => {
    const saturday = 5 * 14
    const split = availabilityReply(schedule({ slots: [saturday, saturday + 1, saturday + 6, saturday + 7] }))
    expect(split.content).toContain('Sat: 5 PM – 6 PM, 8 PM – 9 PM')
    expect(availabilityReply(schedule({ hasSchedule: false, slots: [] })).content).toMatch(
      /haven't set usual times yet/,
    )
    expect(availabilityReply(schedule({ gridChanged: true, slots: [] })).content).toMatch(
      /planning hours changed/,
    )
    expect(availabilityReply(schedule({ paused: true })).content).toMatch(/paused\. Saving here starts it/)
    expect(availabilityReply(schedule({ weekAnswered: true })).content).toMatch(
      /already answered the week of 2026-10-19/,
    )
    expect(availabilityReply({ outcome: 'not-member' }).content).toMatch(/not linked/)
    expect(availabilityReply(schedule({ guildName: '**Loud**' })).content).toContain('\\*\\*Loud\\*\\*')
  })

  it('redraws the controls for each pick, without the database', async () => {
    const days = await run(select('wad:17:14:0:-:-', ['1', '3']))
    expect(days.body.type).toBe(7)
    expect(days.body.data.content).toBeUndefined()
    expect(ids(days.body.data.components)[0]).toBe('wad:17:14:10:-:-')
    expect(
      options(days.body.data.components, 0)
        .filter((o) => o.default)
        .map((o) => o.label),
    ).toEqual(['Tue', 'Thu'])
    expect(days.rpc).not.toHaveBeenCalled()

    const from = await run(select('waf:17:14:10:-:-', ['4']))
    expect(ids(from.body.data.components)[0]).toBe('wad:17:14:10:4:-')
    const until = await run(select('wat:17:14:10:4:-', ['12']))
    const controls = until.body.data.components
    expect(ids(controls)[3]).toBe('was:17:14:10:4:12')
    expect(controls[3].components.map((b) => b.disabled)).toEqual([false, false])
    expect(options(controls, 2).find((o) => o.default).label).toBe('11 PM')

    const cleared = await run(select('wad:17:14:10:4:12', []))
    expect(ids(cleared.body.data.components)[0]).toBe('wad:17:14:0:4:12')
  })

  it('saves the picked days as available and shows the updated times', async () => {
    const { body, calls, followup } = await run(button('was:17:14:10:4:12'), {
      set_availability_from_discord: schedule({ outcome: 'saved' }),
    })
    expect(body.type).toBe(6)
    expect(calls('set_availability_from_discord')).toEqual([
      {
        ...WHO,
        p_days: [1, 3],
        p_from: 4,
        p_to: 12,
        p_available: true,
        p_day_start_hour: 17,
        p_slots_per_day: 14,
      },
    ])
    const message = followup.mock.calls[0][1]
    expect(message.content).toMatch(
      /^Saved: Tue, Thu available 7 PM – 11 PM\.\n\*\*Your usual raid times\*\*/,
    )
    expect(ids(message.components)[0]).toBe('wad:17:14:0:-:-')
  })

  it('saves the picked days as not available', async () => {
    const { calls, followup } = await run(button('wan:17:14:96:-:-'), {
      set_availability_from_discord: schedule({ outcome: 'saved' }),
    })
    expect(calls('set_availability_from_discord')[0]).toMatchObject({
      p_days: [5, 6],
      p_from: null,
      p_to: null,
      p_available: false,
    })
    expect(followup.mock.calls[0][1].content).toMatch(/^Saved: not available on Sat, Sun\./)
  })

  it('shows fresh menus when the guild hours changed since the menus were drawn', async () => {
    const { calls, followup } = await run(button('was:17:14:10:4:12'), {
      set_availability_from_discord: { outcome: 'stale' },
      discord_availability: schedule({ dayStartHour: 18, slotsPerDay: 12 }),
    })
    expect(calls('discord_availability')).toEqual([WHO])
    const message = followup.mock.calls[0][1]
    expect(message.content).toMatch(/^Your guild changed its planning hours, so nothing was saved/)
    expect(ids(message.components)[0]).toBe('wad:18:12:0:-:-')
  })

  it('reports a failed save', async () => {
    const { followup } = await run(button('wan:17:14:1:-:-'), {
      set_availability_from_discord: () => Promise.reject(new Error('down')),
    })
    const message = followup.mock.calls[0][1]
    expect(message.content).toBe('Your times could not be saved. Try again in a moment.')
    // The picks stay, so the player can press the button again.
    expect(ids(message.components)[4]).toBe('wan:17:14:1:-:-')
  })

  it('offers the half-hour end of a day that does not end on the hour', () => {
    const controls = availabilityReply(schedule({ slotsPerDay: 13, slots: [] })).components
    expect(options(controls, 2).at(-1)).toEqual({ label: '11:30 PM', value: '13' })
    expect(options(controls, 1).at(-1)).toEqual({ label: '11 PM', value: '12' })
  })

  it('rejects forged or impossible controls without calling the database', async () => {
    const forged = [
      button('was:17:14:10:4:4'),
      button('was:17:14:10:12:4'),
      button('was:17:14:10:4:-'),
      button('was:17:14:0:4:12'),
      button('wan:17:14:0:-:-'),
      button('wan:17:14:128:-:-'),
      button('wan:24:14:1:-:-'),
      button('wan:17:49:1:-:-'),
      button('wan:17:0:1:-:-'),
      button('was:17:14:1:4:15'),
      select('waf:17:14:0:-:-', ['3']),
      select('waf:17:14:0:-:-', ['14']),
      select('wat:17:14:0:-:-', ['1']),
      select('wat:17:14:0:-:-', ['12', '14']),
      select('wad:17:14:0:-:-', ['7']),
      select('wad:17:14:0:-:-', ['x']),
      select('was:17:14:10:4:12', ['1']),
      // Not on a message this bot wrote.
      button('wan:17:14:1:-:-', { id: PRIVATE, author: { id: USER } }),
    ]
    for (const payload of forged) {
      const { response, rpc } = await run(payload)
      expect(response.status, payload.data.custom_id).toBe(400)
      expect(rpc).not.toHaveBeenCalled()
    }
  })
})
