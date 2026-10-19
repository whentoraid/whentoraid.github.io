<script>
  import { app } from '../lib/app.svelte.js'
  import {
    leaveGuild,
    createOnlineGuild,
    localTestSignIn,
    localTestSignInAvailable,
    openGuild,
    remote,
    retryDiscordJoin,
    signIn,
    signOut,
  } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /** Sign-in, choosing an online guild, and moving the browser guild online. */
  let busy = $state(false)
  /** Shown inside the panel, so it stays readable when the panel is in a dialog. */
  let error = $state('')

  async function run(action, done) {
    busy = true
    error = ''
    try {
      await action()
      if (done) showToast(done)
    } catch (failure) {
      error = failure.message
    } finally {
      busy = false
    }
  }

  /** Set when sign-out found unsaved drafts: the next click discards them. */
  let discardDrafts = $state(false)

  async function signOutOrConfirm() {
    busy = true
    error = ''
    try {
      await signOut({ discardDrafts })
      discardDrafts = false
    } catch (failure) {
      discardDrafts = failure.code === 'UNSAVED_DRAFTS'
      error = failure.message
    } finally {
      busy = false
    }
  }

  const moveOnline = () =>
    run(
      () => createOnlineGuild($state.snapshot(app.data)),
      'Your guild is online. Invite players with the invite link on Guild members.',
    )
</script>

{#if !remote.enabled}
  <p>This copy of WhenToRaid has no server connected. Everything is saved in this browser only.</p>
  <p class="note">
    To play together, host it with a Supabase project (see the README): players then sign in with Discord and
    see the same guild.
  </p>
{:else if !remote.ready}
  <p>Checking sign-in…</p>
{:else if !remote.signedIn}
  <p>
    Sign in with Discord to plan with your guild online. Everyone sees the same roster, and each player fills
    in their own availability.
  </p>
  {#if remote.signInError}<p class="warning" role="alert">{remote.signInError}</p>{/if}
  <button class="primary" onclick={signIn}>Sign in with Discord</button>
  {#if localTestSignInAvailable}
    <div class="local-test-sign-in spaced-top">
      <p class="note">
        Local development only: sign in as a test player without Discord. The test officer’s Discord ID is
        <code>100000000000000001</code>, the test player’s <code>100000000000000002</code>; add the player’s
        ID to a member to invite them.
      </p>
      <div class="buttons">
        <button disabled={busy} onclick={() => run(() => localTestSignIn('officer'))}
          >Sign in as test officer</button
        >
        <button disabled={busy} onclick={() => run(() => localTestSignIn('player'))}
          >Sign in as test player</button
        >
      </div>
    </div>
  {/if}
{:else}
  <p>Signed in with Discord. Guilds connected to your server appear below automatically.</p>
  {#if remote.discordId}
    <details class="note">
      <summary>Your Discord account ID</summary>
      <code>{remote.discordId}</code>
    </details>
  {/if}

  {#if remote.guilds.length}
    <h3>Your online guilds</h3>
    <div class="buttons">
      {#each remote.guilds as guild (guild.id)}
        <button
          class:primary={guild.id === remote.guildId}
          disabled={busy || guild.id === remote.guildId}
          onclick={() => run(() => openGuild(guild.id))}
        >
          {guild.name}{guild.id === remote.guildId ? ' (open)' : ''}
        </button>
      {/each}
    </div>
  {:else}
    {#if remote.joinError}
      <p class="warning" role="alert">{remote.joinError}</p>
    {:else}
      <p class="note">
        No connected guild found yet. Ask your guild owner to add WhenToRaid to your Discord server, or open a
        personal invite link from an officer. If you own the server, create the guild below.
      </p>
    {/if}
    <button disabled={remote.joining} onclick={retryDiscordJoin}>
      {remote.joining ? 'Checking Discord…' : 'Check my Discord server again'}
    </button>
  {/if}
  {#if remote.guilds.length && remote.joinError}
    <p class="warning" role="alert">{remote.joinError}</p>
    <button disabled={remote.joining} onclick={retryDiscordJoin}>
      {remote.joining ? 'Checking Discord…' : 'Check my Discord server again'}
    </button>
  {/if}

  <div class="buttons spaced-top">
    {#if remote.guildId}
      <button disabled={busy} onclick={() => run(leaveGuild)}>Use the guild saved in this browser</button>
    {:else if app.data}
      <button class="primary" disabled={busy} onclick={moveOnline}>Move “{app.data.guild.name}” online</button
      >
    {/if}
    <button disabled={busy} onclick={signOutOrConfirm}
      >{discardDrafts ? 'Discard unsaved edits and sign out' : 'Sign out'}</button
    >
  </div>
{/if}

{#if error}<p class="warning" role="alert">{error}</p>{/if}
