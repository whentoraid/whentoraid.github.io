import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const CODE = '0123456789abcdef0123456789abcdef'

vi.mock('../lib/remote/client.js', () => ({
  isLocalBackend: false,
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { user_metadata: { custom_claims: { global_name: 'Wren' } } } } },
      }),
    },
  },
}))
vi.mock('../lib/remote/api.js', () => ({
  inviteDetails: vi.fn(),
  joinGuild: vi.fn(async () => 'guild-1'),
  listGuilds: vi.fn(async () => [{ id: 'guild-1', name: 'The After Hours' }]),
}))
vi.mock('../lib/remote/sync.svelte.js', () => ({
  remote: { ready: true, signedIn: true, guildId: null, guilds: [] },
  openGuild: vi.fn(async () => {}),
  signIn: vi.fn(),
}))

const api = await import('../lib/remote/api.js')
const sync = await import('../lib/remote/sync.svelte.js')
const { captureInvite, invite, loadInvite } = await import('../lib/remote/invite.svelte.js')
const { default: JoinGuildDialog } = await import('./JoinGuildDialog.svelte')
const { app } = await import('../lib/app.svelte.js')
const { createSeedState } = await import('../lib/seed.js')

function openInviteLink() {
  history.replaceState(null, '', `/?join=${CODE}#/planner`)
  captureInvite()
}

describe('joining from an invite link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    app.data = createSeedState()
    Object.assign(sync.remote, { ready: true, signedIn: true, guildId: null })
    api.inviteDetails.mockResolvedValue({
      guildId: 'guild-1',
      guildName: 'The After Hours',
      alreadyMember: false,
      openPlayers: [],
    })
  })

  test('the code leaves the address and survives the sign-in round trip', () => {
    openInviteLink()
    expect(location.search).toBe('')
    expect(location.hash).toBe('#/planner')
    invite.code = null
    captureInvite()
    expect(invite.code).toBe(CODE)
  })

  test('signed out, the dialog asks to sign in with Discord', async () => {
    sync.remote.signedIn = false
    openInviteLink()
    render(JoinGuildDialog)
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with Discord' }))
    expect(sync.signIn).toHaveBeenCalled()
  })

  test('a new player joins under their Discord name and starts with their first character', async () => {
    app.data = {
      ...app.data,
      characters: app.data.characters.filter((c) => c.memberId !== app.data.currentMemberId),
    }
    openInviteLink()
    render(JoinGuildDialog)
    await loadInvite()
    expect(await screen.findByRole('heading', { name: 'Join The After Hours' })).toBeTruthy()
    expect(screen.getByLabelText('Your name in the guild').value).toBe('Wren')

    await fireEvent.click(screen.getByRole('button', { name: 'Join guild' }))
    await vi.waitFor(() => expect(sync.openGuild).toHaveBeenCalledWith('guild-1'))
    expect(api.joinGuild).toHaveBeenCalledWith(expect.anything(), CODE, { memberId: null, name: 'Wren' })
    expect(invite.code).toBeNull()
    expect(sessionStorage.getItem('whentoraid-invite')).toBeNull()
    expect(app.view).toBe('characters')
  })

  test('a personal link claims only its named player without a profile picker', async () => {
    api.inviteDetails.mockResolvedValueOnce({
      guildId: 'guild-1',
      guildName: 'The After Hours',
      alreadyMember: false,
      openPlayers: [{ id: 'm-nova', name: 'Nova' }],
    })
    openInviteLink()
    render(JoinGuildDialog)
    await loadInvite()
    expect(await screen.findByText(/personal invite for Nova/)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByLabelText('Your name in the guild')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Join guild' }))
    await vi.waitFor(() =>
      expect(api.joinGuild).toHaveBeenCalledWith(expect.anything(), CODE, {
        memberId: 'm-nova',
        name: 'Wren',
      }),
    )
    expect(app.view).toBe('availability')
  })

  test('a refused join is shown in the dialog, which stays open', async () => {
    api.joinGuild.mockRejectedValueOnce(new Error('Someone else already claimed that player.'))
    openInviteLink()
    render(JoinGuildDialog)
    await loadInvite()
    await screen.findByLabelText('Your name in the guild')
    await fireEvent.click(screen.getByRole('button', { name: 'Join guild' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/already claimed/)
    expect(invite.code).toBe(CODE)
  })

  test('an invite to a guild you are already in just opens it', async () => {
    api.inviteDetails.mockResolvedValue({
      guildId: 'guild-1',
      guildName: 'X',
      alreadyMember: true,
      openPlayers: [],
    })
    openInviteLink()
    await loadInvite()
    expect(sync.openGuild).toHaveBeenCalledWith('guild-1')
    expect(invite.code).toBeNull()
  })

  test('a dead link explains itself', async () => {
    api.inviteDetails.mockRejectedValueOnce(
      Object.assign(new Error('This invite link no longer works.'), { code: 'P0002' }),
    )
    openInviteLink()
    render(JoinGuildDialog)
    await loadInvite()
    expect(await screen.findByText('This invite link no longer works.')).toBeTruthy()
    expect(screen.getByText(/Ask a guild officer for a new invite link/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry invite' })).toBeNull()
  })

  test('a temporary lookup failure can be retried without losing the invite', async () => {
    api.inviteDetails.mockRejectedValueOnce(new Error('Failed to fetch'))
    openInviteLink()
    render(JoinGuildDialog)
    await loadInvite()
    await fireEvent.click(await screen.findByRole('button', { name: 'Retry invite' }))
    expect(await screen.findByRole('heading', { name: 'Join The After Hours' })).toBeTruthy()
    expect(invite.code).toBe(CODE)
    expect(api.inviteDetails).toHaveBeenCalledTimes(2)
  })

  test('closing an invitation discards a delayed lookup result', async () => {
    let resolve
    api.inviteDetails.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    openInviteLink()
    render(JoinGuildDialog)
    const pending = loadInvite()
    const { dismissInvite } = await import('../lib/remote/invite.svelte.js')
    dismissInvite()
    resolve({ guildId: 'guild-1', alreadyMember: true })
    await pending
    expect(sync.openGuild).not.toHaveBeenCalled()
    expect(invite.details).toBeNull()
  })
})
