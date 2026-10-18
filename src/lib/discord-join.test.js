// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import {
  discordName,
  interactionJoinArgs,
  joinLinkedServers,
} from '../../supabase/functions/_shared/discord-join.js'
import { handleDiscordInteraction } from '../../supabase/functions/_shared/discord-interactions.js'

const APP = '123456789012345678'
const USER = '223456789012345678'
const SERVER = '323456789012345678'
const OTHER_SERVER = '333456789012345678'
const GONE_SERVER = '343456789012345678'
const OFFICER_ROLE = '423456789012345678'
const GUILD = '00000000-0000-4000-8000-0000000000aa'
const JOB = '00000000-0000-4000-8000-000000000002'
const NOW = 1792000000000

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status })

describe('discordName', () => {
  it('prefers the server nickname, then the display name, then the username', () => {
    const user = { id: USER, username: 'thrall', global_name: 'Thrall' }
    expect(discordName({ nick: 'Warchief', user })).toBe('Warchief')
    expect(discordName({ nick: null, user })).toBe('Thrall')
    expect(discordName({ user: { ...user, global_name: null } })).toBe('thrall')
    expect(discordName(undefined)).toBe('')
  })
})

describe('interactionJoinArgs', () => {
  it('uses only the member and server Discord signed into the interaction', () => {
    const args = interactionJoinArgs({
      guild_id: SERVER,
      member: { nick: 'Jaina', roles: [OFFICER_ROLE], user: { id: USER, username: 'jaina' } },
    })
    expect(args).toEqual({
      p_server_id: SERVER,
      p_discord_id: USER,
      p_name: 'Jaina',
      p_role_ids: [OFFICER_ROLE],
    })
  })

  it('skips interactions from outside a server', () => {
    expect(interactionJoinArgs({ user: { id: USER } })).toBeNull()
    expect(
      interactionJoinArgs({ guild_id: SERVER, member: { roles: 'nope', user: { id: USER } } }).p_role_ids,
    ).toEqual([])
  })
})

describe('joinLinkedServers', () => {
  const discord = (routes) =>
    vi.fn(async (url, init) => {
      expect(init.headers.Authorization).toBe('Bot bot-secret')
      const server = /guilds\/(\d+)\/members\/(\d+)$/.exec(url)[1]
      const route = routes[server]
      return typeof route === 'number' ? jsonResponse({ message: 'nope' }, route) : jsonResponse(route)
    })

  it('joins the guilds of the servers the player is in, with their name and roles', async () => {
    const fetchFn = discord({
      [SERVER]: { nick: 'Jaina', roles: [OFFICER_ROLE], user: { id: USER } },
      [OTHER_SERVER]: 404,
      [GONE_SERVER]: 403,
    })
    const rpc = vi.fn().mockResolvedValue({ guildIds: [GUILD] })
    const ids = await joinLinkedServers({
      discordId: USER,
      servers: [SERVER, OTHER_SERVER, GONE_SERVER, SERVER],
      botToken: 'bot-secret',
      rpc,
      fetchFn,
    })
    expect(ids).toEqual([GUILD])
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('join_from_discord', {
      p_server_id: SERVER,
      p_discord_id: USER,
      p_name: 'Jaina',
      p_role_ids: [OFFICER_ROLE],
    })
  })

  it('logs a failing server and still joins the others', async () => {
    const log = vi.fn()
    const rpc = vi.fn().mockResolvedValue({ guildIds: [GUILD] })
    const ids = await joinLinkedServers({
      discordId: USER,
      servers: [OTHER_SERVER, SERVER],
      botToken: 'bot-secret',
      rpc,
      fetchFn: discord({ [OTHER_SERVER]: 429, [SERVER]: { user: { id: USER, username: 'jaina' } } }),
      log,
    })
    expect(ids).toEqual([GUILD])
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_name: 'jaina', p_role_ids: [] })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('429'))
  })

  it('reports nothing when there are no linked servers', async () => {
    const fetchFn = vi.fn()
    expect(
      await joinLinkedServers({ discordId: USER, servers: [], botToken: 'x', rpc: vi.fn(), fetchFn }),
    ).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('joining from a bot button', () => {
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
  const press = {
    id: '623456789012345679',
    application_id: APP,
    type: 3,
    token: 'valid_interaction_token',
    guild_id: SERVER,
    channel_id: '723456789012345678',
    member: { nick: 'Newcomer', roles: [OFFICER_ROLE], user: { id: USER } },
    message: { id: '823456789012345678', author: { id: APP, bot: true } },
    data: { component_type: 2, custom_id: `wts:${JOB}:tentative` },
  }

  async function run(rpc, log = vi.fn()) {
    const work = []
    await handleDiscordInteraction(await signed(press), {
      publicKey,
      applicationId: APP,
      now: NOW,
      rpc,
      followup: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      schedule: (promise) => work.push(promise),
      log,
    })
    await Promise.all(work)
  }

  it('joins the presser before saving, so a newcomer can sign up straight away', async () => {
    const rpc = vi.fn(async (name) =>
      name === 'join_from_discord'
        ? { guildIds: [GUILD] }
        : { outcome: 'saved', status: 'tentative', guildId: GUILD },
    )
    await run(rpc)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['join_from_discord', 'signup_from_discord'])
    expect(rpc.mock.calls[0][1]).toEqual({
      p_server_id: SERVER,
      p_discord_id: USER,
      p_name: 'Newcomer',
      p_role_ids: [OFFICER_ROLE],
    })
  })

  it('still saves the sign-up when joining fails', async () => {
    const log = vi.fn()
    const rpc = vi.fn(async (name) => {
      if (name === 'join_from_discord') throw new Error('timeout')
      return { outcome: 'saved', status: 'tentative', guildId: GUILD }
    })
    await run(rpc, log)
    expect(rpc).toHaveBeenLastCalledWith('signup_from_discord', expect.any(Object))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('join failed: timeout'))
  })
})
