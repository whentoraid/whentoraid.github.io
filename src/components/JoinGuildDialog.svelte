<script>
  import Modal from './Modal.svelte'
  import {
    acceptInvite,
    dismissInvite,
    invite,
    inviteErrorKind,
    retryInvite,
  } from '../lib/remote/invite.svelte.js'
  import { remote, signIn } from '../lib/remote/sync.svelte.js'

  /** Personal links name a single profile; general links create a new member. */
  const player = $derived(invite.details?.openPlayers[0] ?? null)
  let name = $state('')

  // Offer the Discord display name once the invite has loaded.
  $effect(() => {
    if (invite.status === 'ready' && !name) name = invite.suggestedName
  })

  /** Shown in the dialog: a toast would sit behind it. */
  let error = $state(null)
  let joinErrorKind = $state(null)

  async function join(event) {
    event.preventDefault()
    error = null
    joinErrorKind = null
    try {
      await acceptInvite({ memberId: player?.id ?? null, name })
    } catch (failure) {
      error = failure.message
      joinErrorKind = inviteErrorKind(failure)
    }
  }
</script>

<Modal
  open={invite.code !== null && remote.ready}
  onclose={dismissInvite}
  label={invite.details ? `Join ${invite.details.guildName}` : 'Guild invitation'}
>
  {#if !remote.signedIn}
    <h2>You’re invited to a raid team</h2>
    <p>
      Sign in with Discord to join the guild. Your officers plan raids around everyone’s availability here.
    </p>
    <div class="buttons">
      <button class="primary" onclick={signIn}>Sign in with Discord</button>
      <button onclick={dismissInvite}>Not now</button>
    </div>
  {:else if invite.status === 'error'}
    <h2>Invite link</h2>
    <p class="warning" role="alert">{invite.error}</p>
    <p>
      {invite.errorKind === 'expired'
        ? 'Ask a guild officer for a new invite link, then open it here.'
        : invite.errorKind === 'access'
          ? 'Check that you signed in with the Discord account your guild knows. Ask an officer for a personal link if this is an existing profile.'
          : 'Your invite has been kept. Check your connection and try again.'}
    </p>
    <div class="buttons">
      {#if invite.errorKind === 'temporary'}<button class="primary" onclick={retryInvite}>Retry invite</button
        >{/if}
      <button onclick={dismissInvite}>Close</button>
    </div>
  {:else if invite.details && (invite.status === 'ready' || invite.status === 'joining')}
    <h2>Join {invite.details.guildName}</h2>
    <form onsubmit={join}>
      {#if player}
        <p>
          This is a personal invite for {player.name}. Joining links your Discord account to their characters
          and history.
        </p>
        <p class="note">
          If this is not your profile, close this dialog and ask an officer for your own link.
        </p>
      {:else}
        <p>
          Join as a new player. If an officer already added your profile, ask them for a personal invite to
          keep your characters and history.
        </p>
        <label class="field">
          Your name in the guild
          <input required maxlength="30" autocomplete="nickname" bind:value={name} />
        </label>
      {/if}
      {#if error}
        <p class="warning" role="alert">{error}</p>
        <p>
          {joinErrorKind === 'expired'
            ? 'Ask an officer for a new invitation.'
            : joinErrorKind === 'access'
              ? 'If this is not your profile, close this invitation and ask an officer for your own personal link. You can review your signed-in account under Account & guilds.'
              : 'Your name and invite have been kept. Try joining again when your connection is available.'}
        </p>
      {/if}
      <div class="buttons spaced-top">
        <button class="primary" disabled={invite.status === 'joining'}
          >{invite.status === 'joining' ? 'Joining…' : 'Join guild'}</button
        >
        <button type="button" onclick={dismissInvite}>Not now</button>
      </div>
    </form>
  {:else}
    <h2>Invite link</h2>
    <p>Checking your invite…</p>
  {/if}
</Modal>
