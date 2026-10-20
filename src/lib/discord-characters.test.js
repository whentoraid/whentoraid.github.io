// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { handleDiscordInteraction } from '../../supabase/functions/_shared/discord-interactions.js'
import {
  CLASS_SPEC_CHOICES,
  characterForm,
  characterListReply,
} from '../../supabase/functions/_shared/discord-characters.js'
import { SPEC_ROLES } from './constants.js'

const APP = '123456789012345678'
const USER = '223456789012345678'
const CHANNEL = '323456789012345678'
const SERVER = '423456789012345678'
const POST = '523456789012345678'
const PRIVATE = '533456789012345678'
const JOB = '00000000-0000-4000-8000-000000000002'
const GUILD = '00000000-0000-4000-8000-0000000000aa'
const NOW = 1792000000000
const CONTEXT = `${JOB}:${POST}:signed`
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

const base = (type, data, message = { id: PRIVATE, author: { id: APP, bot: true } }) => ({
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
const select = (custom_id, value, message) =>
  base(3, { component_type: 3, custom_id, values: [value] }, message)
const button = (custom_id) => base(3, { component_type: 2, custom_id })
const form = (custom_id, name, realm) =>
  base(5, {
    custom_id,
    components: [
      { type: 1, components: [{ type: 4, custom_id: 'name', value: name }] },
      { type: 1, components: [{ type: 4, custom_id: 'realm', value: realm }] },
    ],
  })
const command = () => ({
  ...base(2, { type: 1, name: 'raid', options: [{ type: 1, name: 'characters' }] }),
  message: undefined,
})

const THRALL = {
  id: 'c-1',
  name: 'Thrall',
  realm: 'Whitemane',
  class: 'Shaman',
  spec: 'Restoration',
  role: 'Healer',
  main: true,
}
const JAINA = {
  id: 'c-2',
  name: 'Jaina',
  realm: 'Whitemane',
  class: 'Mage',
  spec: 'Frost',
  role: 'DPS',
  main: false,
}
const list = (characters) => ({
  outcome: 'ok',
  guildId: GUILD,
  guildName: 'Untitled Guild',
  realm: 'Whitemane',
  characters,
})
const customIds = (message) => message.components.map((row) => row.components[0].custom_id)

async function run(payload, results = {}) {
  const work = []
  const rpc = vi.fn(async (name) => (typeof results[name] === 'function' ? results[name]() : results[name]))
  const followup = vi.fn()
  const refresh = vi.fn().mockResolvedValue(undefined)
  const response = await handleDiscordInteraction(await signed(payload), {
    publicKey,
    applicationId: APP,
    appUrl: 'https://whentoraid.example/app/',
    now: NOW,
    rpc,
    followup,
    refresh,
    schedule: (promise) => work.push(promise),
  })
  await Promise.all(work)
  const calls = (name) => rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args)
  return { response, body: await response.json(), rpc, calls, followup, refresh }
}

describe('character setup in Discord', () => {
  it('offers every spec the app and database offer', () => {
    const expected = Object.fromEntries(
      Object.entries(SPEC_ROLES).map(([className, specs]) => [
        className,
        Object.entries(specs).flatMap(([spec, role]) =>
          role
            ? [[spec, role]]
            : [
                [spec, 'Tank'],
                [spec, 'DPS'],
              ],
        ),
      ]),
    )
    expect(CLASS_SPEC_CHOICES).toEqual(expected)
  })

  it('starts setup from a sign-up press by a player with no characters', async () => {
    const press = base(
      3,
      { component_type: 2, custom_id: `wts:${JOB}:signed` },
      { id: POST, author: { id: APP } },
    )
    const { followup } = await run(press, { signup_from_discord: { outcome: 'no-characters' } })
    const message = followup.mock.calls[0][1]
    expect(message.content).toMatch(/Add the one you're bringing/)
    expect(message.components[0].components[0].custom_id).toBe(`wcc:${CONTEXT}`)
    expect(message.components[0].components[0].options.map((o) => o.value)).toContain('Druid')
    expect(message.components[1].components[0].url).toBe('https://whentoraid.example/app/#/characters')
  })

  it('answers a class choice with that class’s specs, without saving anything', async () => {
    const { body, rpc } = await run(select(`wcc:${CONTEXT}`, 'Druid'))
    expect(body.type).toBe(7)
    const menu = body.data.components[0].components[0]
    expect(menu.custom_id).toBe(`wcp:${CONTEXT}:8`)
    expect(menu.options.map((o) => o.label)).toEqual([
      'Balance · DPS',
      'Feral Combat · Tank',
      'Feral Combat · DPS',
      'Restoration · Healer',
    ])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('opens the name form with the likely realm filled in', async () => {
    const { body, calls } = await run(select(`wcp:${CONTEXT}:8`, '1'), { discord_characters: list([]) })
    expect(body.type).toBe(9)
    expect(body.data.custom_id).toBe(`wcn:${CONTEXT}:8:1`)
    expect(body.data.title).toBe('New Feral Combat Druid')
    const [name, realm] = body.data.components.map((row) => row.components[0])
    expect(name).toMatchObject({ custom_id: 'name', max_length: 30, required: true })
    expect(name.value).toBeUndefined()
    expect(realm).toMatchObject({ custom_id: 'realm', value: 'Whitemane' })
    expect(calls('discord_characters')).toEqual([WHO])
    // The form answers the interaction itself, so it skips the join.
    expect(calls('join_from_discord')).toEqual([])
  })

  it('still opens the form when the realm cannot be looked up', async () => {
    const { body } = await run(select('wcp:me:0', '2'), {
      discord_characters: () => Promise.reject(new Error('down')),
    })
    expect(body.type).toBe(9)
    expect(body.data.title).toBe('New Protection Warrior')
    expect(body.data.components[1].components[0].value).toBeUndefined()
  })

  it('keeps every form title and id within Discord’s limits', () => {
    for (const [className, specs] of Object.entries(CLASS_SPEC_CHOICES))
      specs.forEach(([spec, role], specIndex) => {
        const modal = characterForm(
          { context: CONTEXT, classIndex: 0, specIndex, choice: { className, spec, role } },
          'x'.repeat(80),
        )
        expect(modal.title.length).toBeLessThanOrEqual(45)
        expect(modal.custom_id.length).toBeLessThanOrEqual(100)
        expect(modal.components[1].components[0].value).toHaveLength(60)
      })
  })

  it('adds the character from the form and finishes the sign-up with it', async () => {
    const { body, calls, followup, refresh } = await run(
      form(`wcn:${CONTEXT}:8:1`, '  Hamuul ', 'Whitemane'),
      {
        add_character_from_discord: {
          outcome: 'saved',
          guildId: GUILD,
          character: { id: 'new-1', name: 'Hamuul', main: true },
        },
        signup_from_discord: {
          outcome: 'saved',
          status: 'signed',
          raidName: 'Molten Core',
          guildId: GUILD,
          character: 'Hamuul',
          class: 'Druid',
          spec: 'Feral Combat',
          role: 'Tank',
        },
        signup_standing: { bench: false },
      },
    )
    expect(body.type).toBe(6)
    expect(calls('add_character_from_discord')).toEqual([
      {
        ...WHO,
        p_name: 'Hamuul',
        p_realm: 'Whitemane',
        p_class: 'Druid',
        p_spec: 'Feral Combat',
        p_role: 'Tank',
      },
    ])
    expect(calls('signup_from_discord')).toEqual([
      {
        p_interaction_id: '623456789012345679',
        ...WHO,
        p_delivery_id: JOB,
        p_message_id: POST,
        p_status: 'signed',
        p_character_id: 'new-1',
      },
    ])
    expect(followup).toHaveBeenCalledTimes(1)
    expect(followup.mock.calls[0][1].content).toBe(
      "Added **Hamuul** as your main.\nYou're signed up for Molten Core as Hamuul (Feral Combat Druid, Tank).",
    )
    expect(refresh).toHaveBeenCalledWith(GUILD)
  })

  it('explains a refused character and does not sign up', async () => {
    const { calls, followup } = await run(form(`wcn:${CONTEXT}:0:0`, 'Garrosh', 'Whitemane'), {
      add_character_from_discord: { outcome: 'too-many' },
    })
    expect(calls('signup_from_discord')).toEqual([])
    expect(followup.mock.calls[0][1]).toEqual({
      content: 'You already have 20 characters. Delete one before adding another.',
      components: [],
    })
  })

  it('adds from /raid characters and shows the updated list', async () => {
    const { calls, followup } = await run(form('wcn:me:6:2', 'Jaina', 'Whitemane'), {
      add_character_from_discord: {
        outcome: 'saved',
        guildId: GUILD,
        character: { id: 'c-2', name: 'Jaina', main: false },
      },
      discord_characters: list([THRALL, JAINA]),
    })
    expect(calls('add_character_from_discord')[0]).toMatchObject({ p_class: 'Mage', p_spec: 'Frost' })
    expect(calls('signup_from_discord')).toEqual([])
    expect(followup.mock.calls[0][1].content).toMatch(/^Added \*\*Jaina\*\*\.\n\*\*Your characters\*\*/)
  })

  it('lists characters for /raid characters with menus to add, choose a main and delete', async () => {
    const { body, calls, followup } = await run(command(), { discord_characters: list([THRALL, JAINA]) })
    expect(body).toEqual({ type: 5, data: { flags: 64 } })
    expect(calls('discord_characters')).toEqual([WHO])
    const message = followup.mock.calls[0][1]
    expect(message.content).toBe(
      [
        '**Your characters** in Untitled Guild (⭐ is your main)',
        '⭐ Thrall — Restoration Shaman (Healer) · Whitemane',
        '• Jaina — Frost Mage (DPS) · Whitemane',
      ].join('\n'),
    )
    expect(customIds(message)).toEqual(['wcc:me', 'wcm:me', 'wcr:me'])
    expect(message.components[1].components[0].options[1]).toEqual({
      label: 'Jaina — Frost Mage (DPS)',
      value: 'c-2',
    })
  })

  it('offers only adding to a player with one character or none, and no adding at the limit', () => {
    expect(customIds(characterListReply(list([THRALL])))).toEqual(['wcc:me'])
    expect(characterListReply(list([])).content).toMatch(/add your first/)
    const full = Array.from({ length: 20 }, (_, i) => ({ ...JAINA, id: `c-${i}` }))
    expect(customIds(characterListReply(list(full)))).toEqual(['wcm:me', 'wcr:me'])
  })

  it('escapes names in the list so they cannot format the message', () => {
    const content = characterListReply(list([{ ...THRALL, name: '*Bold*', realm: '__Under__' }])).content
    expect(content).toContain('\\*Bold\\*')
    expect(content).toContain('\\_\\_Under\\_\\_')
  })

  it('explains when the player has no guild here', async () => {
    const { followup } = await run(command(), { discord_characters: { outcome: 'not-member' } })
    expect(followup.mock.calls[0][1].content).toMatch(/not linked to a WhenToRaid guild/)
  })

  it('chooses a main and shows the updated list', async () => {
    const { body, calls, followup } = await run(select('wcm:me', 'c-2'), {
      manage_character_from_discord: { outcome: 'saved', action: 'main', name: 'Jaina' },
      discord_characters: list([
        { ...JAINA, main: true },
        { ...THRALL, main: false },
      ]),
    })
    expect(body.type).toBe(6)
    expect(calls('manage_character_from_discord')).toEqual([
      { ...WHO, p_character_id: 'c-2', p_action: 'main' },
    ])
    expect(followup.mock.calls[0][1].content).toMatch(/^\*\*Jaina\*\* is now your main\.\n/)
  })

  it('asks before deleting, naming the character from the bot’s own menu', async () => {
    const menuMessage = {
      id: PRIVATE,
      author: { id: APP },
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: 'wcr:me',
              options: [{ label: 'Jaina — Frost Mage (DPS)', value: 'c-2' }],
            },
          ],
        },
      ],
    }
    const { body, rpc } = await run(select('wcr:me', 'c-2', menuMessage))
    expect(body.type).toBe(7)
    expect(body.data.content).toBe(
      'Delete **Jaina — Frost Mage \\(DPS\\)**? Past rosters and attendance keep it.',
    )
    expect(body.data.components[0].components.map((b) => b.custom_id)).toEqual(['wcx:c-2', 'wck:me'])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('deletes (retires) after confirmation, and keeping it just shows the list', async () => {
    const deleted = await run(button('wcx:c-2'), {
      manage_character_from_discord: { outcome: 'saved', action: 'retire', name: 'Jaina' },
      discord_characters: list([THRALL]),
    })
    expect(deleted.calls('manage_character_from_discord')).toEqual([
      { ...WHO, p_character_id: 'c-2', p_action: 'retire' },
    ])
    expect(deleted.followup.mock.calls[0][1].content).toMatch(/^Deleted \*\*Jaina\*\*\./)

    const kept = await run(button('wck:me'), { discord_characters: list([THRALL, JAINA]) })
    expect(kept.calls('manage_character_from_discord')).toEqual([])
    expect(kept.followup.mock.calls[0][1].content).toMatch(/^\*\*Your characters\*\*/)
  })

  it('refuses to delete the only character', async () => {
    const { followup } = await run(button('wcx:c-1'), {
      manage_character_from_discord: { outcome: 'only-character', name: 'Thrall' },
      discord_characters: list([THRALL]),
    })
    expect(followup.mock.calls[0][1].content).toMatch(/only character/)
  })

  it('rejects forged or malformed setup steps without calling the database', async () => {
    const forged = [
      select(`wcc:${CONTEXT}`, 'Monk'),
      select(`wcp:${CONTEXT}:8`, '4'),
      select(`wcp:${CONTEXT}:9`, '0'),
      select('wcc:other', 'Mage'),
      select('wcm:me', 'bad id!'),
      form(`wcn:${CONTEXT}:8:9`, 'Hamuul', 'Whitemane'),
      // Not on a message this bot wrote.
      select(`wcc:${CONTEXT}`, 'Mage', { id: PRIVATE, author: { id: USER } }),
    ]
    for (const payload of forged) {
      const { response, rpc } = await run(payload)
      expect(response.status).toBe(400)
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('explains a blank or overlong name or realm privately, without saving', async () => {
    for (const [name, realm] of [
      ['   ', 'Whitemane'],
      ['x'.repeat(31), 'Whitemane'],
      ['Hamuul', '  '],
      ['Hamuul', 'x'.repeat(61)],
    ]) {
      const { body, rpc } = await run(form(`wcn:${CONTEXT}:8:1`, name, realm))
      expect(body.type).toBe(4)
      expect(body.data.flags).toBe(64)
      expect(body.data.content).toMatch(/Enter a character name/)
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('counts name length in characters, so 30 emoji fit', async () => {
    const { body, calls } = await run(form('wcn:me:0:0', '🐉'.repeat(30), 'Whitemane'), {
      add_character_from_discord: { outcome: 'saved', character: { id: 'c-9', name: 'x', main: false } },
      discord_characters: list([THRALL]),
    })
    expect(body.type).toBe(6)
    expect(calls('add_character_from_discord')[0].p_name).toBe('🐉'.repeat(30))
  })

  it('still reports a saved change when the refreshed list cannot be loaded', async () => {
    const { followup } = await run(button('wcx:c-2'), {
      manage_character_from_discord: { outcome: 'saved', action: 'retire', name: 'Jaina' },
      discord_characters: () => Promise.reject(new Error('down')),
    })
    expect(followup.mock.calls[0][1]).toEqual({ content: 'Deleted **Jaina**.', components: [] })
  })

  it('reports a failed save instead of leaving the menu spinning', async () => {
    const { followup } = await run(select('wcm:me', 'c-2'), {
      manage_character_from_discord: () => Promise.reject(new Error('boom')),
    })
    expect(followup.mock.calls[0][1]).toEqual({
      content: 'That change could not be saved. Try again in a moment.',
      components: [],
    })
  })
})
