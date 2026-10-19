<script>
  import { app } from '../lib/app.svelte.js'
  import { openGuild, remote, signIn } from '../lib/remote/sync.svelte.js'

  /**
   * On a site with a server, a guild saved only in this browser looks like the shared one. Say on every
   * page that nothing here reaches the guild or Discord, and lead the player to their online guild.
   */
  const shown = $derived(remote.enabled && remote.ready && !remote.guildId && Boolean(app.data))
  const onlineGuild = $derived(remote.guilds.length === 1 ? remote.guilds[0] : null)
  let busy = $state(false)

  async function open() {
    busy = true
    try {
      await openGuild(onlineGuild.id)
    } finally {
      busy = false
    }
  }
</script>

{#if shown}
  <section class="browser-guild" role="alert" aria-label="Not your online guild">
    <p>
      <strong>This guild is saved only in this browser.</strong>
      Characters, availability and sign-ups here never reach your guild or Discord.
      {#if !remote.signedIn}Sign in with Discord to open your guild.
      {:else if !onlineGuild && remote.guilds.length}Choose your guild in Account & guilds.{/if}
    </p>
    {#if !remote.signedIn}
      <button class="primary" onclick={signIn}>Sign in with Discord</button>
    {:else if onlineGuild}
      <button class="primary" disabled={busy} onclick={open}>Open {onlineGuild.name}</button>
    {/if}
  </section>
{/if}

<style>
  .browser-guild {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--gold);
    border-left-width: 4px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--gold) 12%, var(--panel));
  }
  .browser-guild p {
    margin: 0;
    flex: 1 1 20rem;
    color: var(--text);
  }
</style>
