import { afterEach, expect, test, vi } from 'vitest'
import { waitFor } from '@testing-library/svelte'
import { createSeedState } from '../seed.js'
import { stateToRows } from './rows.js'

const mocked = vi.hoisted(() => ({
  onAuthStateChange: null,
  discordId: null,
  rows: null,
  fetchError: false,
  fetchAttempts: 0,
  applyError: false,
  applyGate: null,
  applied: 0,
  signOutCalls: 0,
  applyHandler: null,
  onSubscription: null,
  joinCalls: 0,
}))

vi.mock('./client.js', () => ({
  isLocalBackend: false,
  supabase: {
    auth: {
      onAuthStateChange(callback) {
        mocked.onAuthStateChange = callback
        return { data: { subscription: { unsubscribe() {} } } }
      },
      async signOut() {
        mocked.signOutCalls += 1
        return { error: null }
      },
    },
    channel() {
      return {
        on() {
          return this
        },
        subscribe(callback) {
          mocked.onSubscription = callback
        },
      }
    },
    removeChannel() {},
  },
}))

vi.mock('./api.js', () => ({
  myDiscordId: async () => mocked.discordId,
  joinFromDiscord: async () => {
    mocked.joinCalls += 1
    if (mocked.joinError) throw new Error('Your Discord server could not be checked. Reload to try again.')
    return mocked.joined ?? []
  },
  // Each call takes the next queued list, if any.
  listGuilds: async () => mocked.guildLists?.shift() ?? [{ id: 'guild-test', name: 'Test guild' }],
  fetchGuild: async () => {
    mocked.fetchAttempts += 1
    if (mocked.fetchError) throw new Error('Offline')
    return mocked.rows
  },
  applyOps: async (...args) => {
    if (mocked.applyGate) await mocked.applyGate
    mocked.applied += 1
    if (mocked.applyHandler) return mocked.applyHandler(...args)
    if (mocked.applyError) throw new Error('Rejected save')
    return 1
  },
  createGuildWithRows: async () => 'guild-test',
}))

import { app } from '../app.svelte.js'
import {
  discardUnsavedChange,
  dismissUnsavedDraft,
  flushOnlineChanges,
  initRemote,
  leaveGuild,
  pushChanges,
  reapplyUnsavedDraft,
  remote,
  signOut,
  retryDiscordJoin,
} from './sync.svelte.js'

/** The stored recovery draft of `userId` for `guildId`, from any page, or null. */
function storedDraft(userId, guildId) {
  const prefix = `whentoraid-unsaved-online-draft:${userId}:${guildId}:`
  const key = Object.keys(localStorage).find((k) => k.startsWith(prefix))
  return key ? localStorage.getItem(key) : null
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  mocked.applyHandler = null
  mocked.applied = 0
  Object.assign(mocked, { joined: null, joinError: false, joinCalls: 0, guildLists: null })
})

test('a player with no guild yet joins from their Discord server at sign-in', async () => {
  const state = createSeedState()
  state.members[1] = { ...state.members[1], discordId: 'discord-newcomer', officer: false }
  mocked.rows = { ...stateToRows(state, 'guild-test'), revision: 0 }
  Object.assign(mocked, { fetchError: false, joined: ['guild-test'], guildLists: [[]] })
  localStorage.setItem('whentoraid-online-guild', 'guild-test')
  const stop = initRemote()
  try {
    mocked.discordId = 'discord-newcomer'
    mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'discord-newcomer' } })
    await waitFor(() => expect(remote.guildId).toBe('guild-test'))
    expect(remote.guilds).toEqual([{ id: 'guild-test', name: 'Test guild' }])
    expect(remote.officer).toBe(false)
  } finally {
    await leaveGuild()
    stop()
  }
})

test('a Discord newcomer with no saved guild lands in it and starts with their first character', async () => {
  const state = createSeedState()
  state.members[1] = { ...state.members[1], discordId: 'discord-fresh', officer: false }
  state.characters = state.characters.filter((c) => c.memberId !== state.members[1].id)
  mocked.rows = { ...stateToRows(state, 'guild-test'), revision: 0 }
  Object.assign(mocked, { fetchError: false, joined: ['guild-test'], guildLists: [[]] })
  const { toast } = await import('../toast.svelte.js')
  const stop = initRemote()
  try {
    mocked.discordId = 'discord-fresh'
    mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'discord-fresh' } })
    await waitFor(() => expect(remote.guildId).toBe('guild-test'))
    await waitFor(() => expect(app.view).toBe('characters'))
    expect(toast.message).toContain('Add your first character')
  } finally {
    await leaveGuild()
    stop()
  }
})

test('a failed Discord check tells a player with no guild, without signing them out', async () => {
  Object.assign(mocked, { joinError: true, guildLists: [[]] })
  const stop = initRemote()
  try {
    mocked.discordId = 'discord-unchecked'
    mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'discord-unchecked' } })
    await waitFor(() => expect(remote.discordId).toBe('discord-unchecked'))
    await waitFor(() => expect(remote.ready).toBe(true))
    expect(remote.signedIn).toBe(true)
    expect(remote.guilds).toEqual([])
    expect(remote.joinError).toContain('Discord server could not be checked')
    mocked.joinError = false
    mocked.guildLists = [[]]
    await retryDiscordJoin()
    expect(remote.joinError).toBeNull()
    expect(mocked.joinCalls).toBe(2)
  } finally {
    stop()
  }
})

test('retry opens the real guild when a failed check left the saved demo open', async () => {
  const realGuild = '11111111-2222-3333-4444-555555555555'
  localStorage.setItem('whentoraid-online-guild', 'demo-guild')
  mocked.rows = { ...stateToRows(createSeedState(), realGuild), revision: 0 }
  Object.assign(mocked, {
    joinError: true,
    guildLists: [[{ id: 'demo-guild', name: 'The After Hours (demo)' }]],
  })
  const stop = initRemote()
  try {
    mocked.discordId = 'discord-real-player'
    mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'discord-real-player' } })
    await waitFor(() => expect(remote.guildId).toBe('demo-guild'))
    await waitFor(() => expect(remote.ready).toBe(true))
    expect(remote.joinError).toBeTruthy()
    mocked.joinError = false
    mocked.joined = [realGuild]
    mocked.guildLists = [
      [
        { id: 'demo-guild', name: 'The After Hours (demo)' },
        { id: realGuild, name: 'Real guild' },
      ],
    ]
    await retryDiscordJoin()
    expect(remote.guildId).toBe(realGuild)
    expect(remote.joinError).toBeNull()
  } finally {
    await leaveGuild()
    stop()
  }
})

test('a personal invite takes precedence over Discord server auto-join', async () => {
  sessionStorage.setItem('whentoraid-invite', '0123456789abcdef0123456789abcdef')
  Object.assign(mocked, { joined: ['guild-test'], guildLists: [[]] })
  const stop = initRemote()
  try {
    mocked.discordId = 'discord-invited'
    mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'discord-invited' } })
    await waitFor(() => expect(remote.discordId).toBe('discord-invited'))
    await waitFor(() => expect(remote.ready).toBe(true))
    expect(mocked.joinCalls).toBe(0)
    expect(remote.guilds).toEqual([])
    sessionStorage.removeItem('whentoraid-invite')
    mocked.guildLists = [[{ id: 'guild-test', name: 'Test guild' }]]
    const state = createSeedState()
    state.members[1] = { ...state.members[1], discordId: 'discord-invited' }
    mocked.rows = { ...stateToRows(state, 'guild-test'), revision: 0 }
    await retryDiscordJoin()
    expect(mocked.joinCalls).toBe(1)
    expect(remote.guildId).toBe('guild-test')
  } finally {
    if (remote.guildId) await leaveGuild()
    stop()
  }
})

test('a Discord bot connection reopens the guild that started it', async () => {
  const connecting = '11111111-2222-3333-4444-555555555555'
  sessionStorage.setItem('whentoraid-discord-connect', JSON.stringify({ state: 's1', guildId: connecting }))
  sessionStorage.setItem('whentoraid-discord-return', JSON.stringify({ code: 'code', state: 's1' }))
  localStorage.setItem('whentoraid-online-guild', 'guild-test')
  const state = createSeedState()
  state.members[0] = { ...state.members[0], discordId: 'discord-owner', officer: true }
  mocked.rows = { ...stateToRows(state, connecting), revision: 0 }
  Object.assign(mocked, {
    joined: [],
    guildLists: [
      [
        { id: 'guild-test', name: 'Other guild' },
        { id: connecting, name: 'New guild' },
      ],
    ],
  })
  const stop = initRemote()
  try {
    mocked.discordId = 'discord-owner'
    mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'discord-owner' } })
    await waitFor(() => expect(remote.guildId).toBe(connecting))
    expect(app.data.guild.name).toBe(state.guild.name)
  } finally {
    await leaveGuild()
    stop()
  }
})

test('a player pinned to the online demo opens the real guild found in Discord', async () => {
  const realGuild = '11111111-2222-3333-4444-555555555555'
  localStorage.setItem('whentoraid-online-guild', 'demo-guild')
  const state = createSeedState()
  state.members[1] = { ...state.members[1], discordId: 'discord-real-player' }
  mocked.rows = { ...stateToRows(state, realGuild), revision: 0 }
  Object.assign(mocked, {
    joined: [realGuild],
    guildLists: [
      [{ id: 'demo-guild', name: 'The After Hours (demo)' }],
      [
        { id: 'demo-guild', name: 'The After Hours (demo)' },
        { id: realGuild, name: 'Real guild' },
      ],
    ],
  })
  const stop = initRemote()
  try {
    mocked.discordId = 'discord-real-player'
    mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'discord-real-player' } })
    await waitFor(() => expect(remote.guildId).toBe(realGuild))
    expect(remote.guilds).toHaveLength(2)
  } finally {
    await leaveGuild()
    stop()
  }
})

async function openConcurrencyGuild(identity) {
  const state = createSeedState()
  state.members[0] = { ...state.members[0], discordId: identity, officer: true }
  mocked.rows = { ...stateToRows(state, 'guild-test'), revision: 0 }
  Object.assign(mocked, { fetchError: false, applyError: false, applyGate: null })
  localStorage.setItem('whentoraid-online-guild', 'guild-test')
  const stop = initRemote()
  mocked.discordId = identity
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: identity } })
  await waitFor(() => expect(remote.discordId).toBe(identity))
  await waitFor(() => expect(remote.guildId).toBe('guild-test'))
  return stop
}

test('resubscribing refreshes changes missed during a disconnected realtime session', async () => {
  const stop = await openConcurrencyGuild('reconnected-officer')
  try {
    mocked.rows = {
      ...mocked.rows,
      guilds: mocked.rows.guilds.map((guild) => ({ ...guild, name: 'Changed while disconnected' })),
      revision: 1,
    }
    mocked.onSubscription('SUBSCRIBED')
    await waitFor(() => expect(app.data.guild.name).toBe('Changed while disconnected'))
    const oldSubscription = mocked.onSubscription
    await leaveGuild()
    const attempts = mocked.fetchAttempts
    oldSubscription('SUBSCRIBED')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocked.fetchAttempts).toBe(attempts)
  } finally {
    stop()
  }
})

test('independent edits retry with the fresh revision and keep queued edits and remote rows', async () => {
  const stop = await openConcurrencyGuild('concurrency-a')
  const original = app.data
  const remoteMember = original.members[1].id
  mocked.rows.members = mocked.rows.members.map((row) =>
    row.id === remoteMember ? { ...row, name: 'Saved by another player' } : row,
  )
  mocked.rows.revision = 1
  const calls = []
  mocked.applyHandler = async (_client, _guild, revision, ops) => {
    calls.push({ revision, ops })
    if (revision === 0) throw Object.assign(new Error('Stale'), { code: '40001' })
    return revision + 1
  }
  app.data = { ...original, guild: { ...original.guild, name: 'Our guild' } }
  pushChanges(app.data)
  app.data = {
    ...app.data,
    members: app.data.members.map((member, i) => (i === 2 ? { ...member, name: 'Queued edit' } : member)),
  }
  pushChanges(app.data)
  await flushOnlineChanges()
  expect(calls.map(({ revision }) => revision)).toEqual([0, 1, 2])
  expect(app.data.guild.name).toBe('Our guild')
  expect(app.data.members[1].name).toBe('Saved by another player')
  expect(app.data.members[2].name).toBe('Queued edit')
  expect(remote.status).toBe('saved')
  expect(remote.hasUnsavedDraft).toBe(false)
  stop()
})

test('a same-row conflict preserves the local draft and flush refuses side effects', async () => {
  const stop = await openConcurrencyGuild('concurrency-b')
  mocked.rows.guilds[0] = { ...mocked.rows.guilds[0], name: 'Their guild' }
  mocked.rows.revision = 1
  mocked.applyHandler = async () => {
    throw Object.assign(new Error('Stale'), { code: '40001' })
  }
  app.data = { ...app.data, guild: { ...app.data.guild, name: 'My guild' } }
  pushChanges(app.data)
  await expect(flushOnlineChanges()).rejects.toThrow(/not saved/)
  expect(JSON.parse(storedDraft('concurrency-b', 'guild-test')).state.guild.name).toBe('My guild')
  await waitFor(() => expect(app.data.guild.name).toBe('Their guild'))
  expect(remote.hasUnsavedDraft).toBe(true)
  dismissUnsavedDraft()
  stop()
})

test('switching directly between signed-in identities replaces the guild viewer', async () => {
  const guildId = 'guild-test'
  const state = createSeedState()
  const first = state.members[0]
  const second = state.members[1]
  const members = state.members.map((member) => ({
    ...member,
    discordId: member.id === first.id ? 'discord-a' : member.id === second.id ? 'discord-b' : '',
    officer: false,
  }))
  mocked.rows = { ...stateToRows({ ...state, members }, guildId), revision: 0 }
  localStorage.setItem('whentoraid-online-guild', guildId)
  const stop = initRemote()
  mocked.discordId = 'discord-a'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-a' } })
  await waitFor(() => expect(remote.memberId).toBe(first.id))

  mocked.discordId = 'discord-b'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-b' } })
  await waitFor(() => expect(remote.memberId).toBe(second.id))
  expect(remote.discordId).toBe('discord-b')
  expect(app.data.currentMemberId).toBe(second.id)

  mocked.applyError = true
  // A player may change their own character, so the failed edit can still be reapplied.
  const characterId = app.data.characters.find((c) => c.memberId === second.id).id
  const renamed = (data) => data.characters.find((c) => c.id === characterId).name
  const originalName = renamed(app.data)
  const edited = {
    ...app.data,
    characters: app.data.characters.map((c) => (c.id === characterId ? { ...c, name: 'Unsaved name' } : c)),
  }
  app.data = edited
  pushChanges(edited)
  await waitFor(() => expect(remote.hasUnsavedDraft).toBe(true))
  expect(renamed(JSON.parse(storedDraft('auth-b', guildId)).state)).toBe('Unsaved name')
  await expect(signOut()).rejects.toThrow(/not saved/)
  expect(mocked.signOutCalls).toBe(0)

  await waitFor(() => expect(renamed(app.data)).toBe(originalName))
  expect(remote.changes).toMatchObject([{ title: 'Your character Unsaved name', outcome: 'ready' }])
  mocked.applyError = false
  let finishSave
  mocked.applyGate = new Promise((resolve) => {
    finishSave = resolve
  })
  reapplyUnsavedDraft()
  pushChanges(app.data)
  expect(storedDraft('auth-b', guildId)).toBeTruthy()

  mocked.discordId = 'discord-a'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-a' } })
  await waitFor(() => expect(remote.memberId).toBe(first.id))
  finishSave()
  await waitFor(() => expect(mocked.applied).toBe(2))
  expect(storedDraft('auth-b', guildId), 'after switching').toBeTruthy()
  expect(remote.hasUnsavedDraft).toBe(false)

  mocked.onAuthStateChange('SIGNED_OUT', null)
  await waitFor(() => expect(remote.signedIn).toBe(false))
  localStorage.setItem('whentoraid-online-guild', guildId)
  mocked.fetchError = true
  const attempts = mocked.fetchAttempts
  mocked.discordId = 'discord-b'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-b' } })
  await waitFor(() => expect(mocked.fetchAttempts).toBeGreaterThan(attempts))
  expect(localStorage.getItem('whentoraid-online-guild')).toBe(guildId)
  stop()
})

test('an edit is still saved online when browser storage refuses the recovery copy', async () => {
  const guildId = 'guild-test'
  const state = createSeedState()
  const members = state.members.map((member, index) => ({
    ...member,
    discordId: index === 0 ? 'discord-c' : '',
    officer: index === 0,
  }))
  mocked.rows = { ...stateToRows({ ...state, members }, guildId), revision: 0 }
  mocked.fetchError = false
  mocked.applyError = false
  mocked.applyGate = null
  localStorage.setItem('whentoraid-online-guild', guildId)
  const stop = initRemote()
  mocked.discordId = 'discord-c'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-c' } })
  await waitFor(() => expect(remote.guildId).toBe(guildId))

  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked')
  })
  const applied = mocked.applied
  const edited = { ...app.data, guild: { ...app.data.guild, name: 'Saved without storage' } }
  app.data = edited
  pushChanges(edited)
  await waitFor(() => expect(mocked.applied).toBe(applied + 1))
  await waitFor(() => expect(remote.status).toBe('saved'))
  expect(remote.hasUnsavedDraft).toBe(false)
  setItem.mockRestore()
  stop()
})

test('drafts belong to their page: open tabs keep theirs, closed tabs offer theirs, sign-out asks first', async () => {
  const guildId = 'guild-test'
  const state = createSeedState()
  const members = state.members.map((member, index) => ({
    ...member,
    discordId: index === 0 ? 'discord-d' : '',
    officer: index === 0,
  }))
  mocked.rows = { ...stateToRows({ ...state, members }, guildId), revision: 0 }
  Object.assign(mocked, { fetchError: false, applyError: false, applyGate: null, signOutCalls: 0 })
  // Another tab is still open: it holds its page lock.
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { query: async () => ({ held: [{ name: 'whentoraid-page:open-page' }] }) },
  })
  const prefix = 'whentoraid-unsaved-online-draft:auth-d:'
  const seeded = { ...state, members, currentMemberId: members[0].id }
  const draftOf = (forGuild, name, savedAt) =>
    JSON.stringify({
      userId: 'auth-d',
      guildId: forGuild,
      savedAt,
      state: { ...seeded, guild: { ...seeded.guild, name } },
    })
  localStorage.setItem(`${prefix}${guildId}:open-page`, draftOf(guildId, 'Open tab edit', 2))
  localStorage.setItem(`${prefix}${guildId}:closed-page`, draftOf(guildId, 'Closed tab edit', 1))
  localStorage.setItem(`${prefix}${guildId}:older-page`, draftOf(guildId, 'Older closed tab edit', 0))
  localStorage.setItem('whentoraid-online-guild', guildId)

  const stop = initRemote()
  mocked.discordId = 'discord-d'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-d' } })
  await waitFor(() => expect(remote.hasUnsavedDraft).toBe(true))
  dismissUnsavedDraft()
  expect(localStorage.getItem(`${prefix}${guildId}:closed-page`)).toBeNull()
  // The next draft a closed tab left is offered in turn.
  await waitFor(() => expect(remote.hasUnsavedDraft).toBe(true))
  dismissUnsavedDraft()
  expect(localStorage.getItem(`${prefix}${guildId}:older-page`)).toBeNull()
  await waitFor(() => expect(remote.status).toBe('saved'))
  expect(remote.hasUnsavedDraft).toBe(false)

  const applied = mocked.applied
  const edited = { ...app.data, guild: { ...app.data.guild, name: 'Saved here' } }
  app.data = edited
  pushChanges(edited)
  await waitFor(() => expect(mocked.applied).toBe(applied + 1))
  await waitFor(() => expect(remote.status).toBe('saved'))
  expect(localStorage.getItem(`${prefix}${guildId}:open-page`)).toBeTruthy()

  localStorage.setItem(`${prefix}guild-other:closed-page`, draftOf('guild-other', 'Elsewhere', 3))
  await expect(signOut()).rejects.toMatchObject({
    code: 'UNSAVED_DRAFTS',
    message: expect.stringMatching(/guilds you can no longer open/),
  })
  expect(mocked.signOutCalls).toBe(0)
  await signOut({ discardDrafts: true })
  expect(mocked.signOutCalls).toBe(1)
  expect(localStorage.getItem(`${prefix}guild-other:closed-page`)).toBeNull()
  expect(localStorage.getItem(`${prefix}${guildId}:open-page`)).toBeTruthy()

  delete navigator.locks
  stop()
})

test('an unsaved edit is reviewed task by task, and a slow save that landed is not offered again', async () => {
  const guildId = 'guild-test'
  const state = createSeedState()
  const me = state.members[0]
  const members = state.members.map((m) => ({
    ...m,
    discordId: m.id === me.id ? 'discord-r' : '',
    // Only officers may rename players.
    officer: m.id === me.id,
  }))
  const withName = (name) => members.map((m) => (m.id === me.id ? { ...m, name } : m))
  mocked.rows = { ...stateToRows({ ...state, members }, guildId), revision: 0 }
  Object.assign(mocked, { fetchError: false, applyError: false, applyGate: null })
  localStorage.setItem('whentoraid-online-guild', guildId)
  const stop = initRemote()
  mocked.discordId = 'discord-r'
  mocked.onAuthStateChange('SIGNED_IN', { user: { id: 'auth-r' } })
  await waitFor(() => expect(remote.discordId).toBe('discord-r'))
  await waitFor(() => expect(remote.memberId).toBe(me.id))
  await waitFor(() => expect(remote.status).toBe('saved'))
  await flushOnlineChanges()

  mocked.applyError = true
  const applied = mocked.applied
  const character = app.data.characters.find((c) => c.memberId === me.id)
  const edited = {
    ...app.data,
    members: app.data.members.map((m) => (m.id === me.id ? { ...m, name: 'Renamed' } : m)),
    characters: app.data.characters.map((c) => (c.id === character.id ? { ...c, spec: 'Changed' } : c)),
  }
  app.data = edited
  pushChanges(edited)
  await waitFor(() => expect(mocked.applied).toBe(applied + 1))
  await waitFor(() => expect(remote.changes).toHaveLength(2))
  expect(remote.changes.every((change) => change.outcome === 'ready')).toBe(true)

  discardUnsavedChange(remote.changes.find((change) => change.task === 'character').id)
  expect(remote.changes.map((change) => change.title)).toEqual(['Your player name'])
  const kept = JSON.parse(storedDraft('auth-r', guildId)).state
  expect(kept.characters.find((c) => c.id === character.id).spec).toBe(character.spec)
  expect(kept.members.find((m) => m.id === me.id).name).toBe('Renamed')

  // The failed save had reached the server after all: nothing is left to recover.
  mocked.applyError = false
  mocked.rows = { ...stateToRows({ ...state, members: withName('Renamed') }, guildId), revision: 1 }
  mocked.onSubscription('SUBSCRIBED')
  await waitFor(() => expect(remote.hasUnsavedDraft).toBe(false))
  expect(storedDraft('auth-r', guildId)).toBeNull()
  expect(remote.status).toBe('saved')

  // Unreachable server: the page says it shows the last loaded version, not that an edit failed.
  mocked.fetchError = true
  mocked.onSubscription('SUBSCRIBED')
  await waitFor(() => expect(remote.status).toBe('stale'))
  mocked.fetchError = false
  await leaveGuild()
  stop()
})
