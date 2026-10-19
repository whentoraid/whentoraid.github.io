<script>
  import { app } from '../lib/app.svelte.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { formatWhen, memberView } from '../lib/raid-history.js'
  import { getRaidHistory } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'

  /**
   * M13: published changes to the player's raid that concern their own place (publishing, their
   * assignment, the time, cancellation), with who made them and why. Officers' drafts never show.
   */
  const SHOWN = 5
  let { item, memberId } = $props()

  let events = $state([])

  $effect(() => {
    const key = `${item.weekIso}|${item.raidId}|${item.plan?.publishedAt}`
    let active = true
    getRaidHistory(supabase, remote.guildId, item.weekIso, item.raidId)
      .then((rows) => {
        if (active && key === `${item.weekIso}|${item.raidId}|${item.plan?.publishedAt}`)
          events = (rows ?? []).slice(0, SHOWN)
      })
      .catch(() => {
        // The history is extra context; the card already shows the current assignment.
        if (active) events = []
      })
    return () => {
      active = false
    }
  })
</script>

{#if events.length}
  <details class="change-log">
    <summary>What changed</summary>
    <ol>
      {#each events as event (event.id)}
        {@const text = memberView(event, app.data, memberId, viewerZone)}
        <li>
          <strong>{text.headline}</strong> <small>{formatWhen(event.at, viewerZone)}</small>
          {#each text.lines as line, i (i)}<p>{line}</p>{/each}
          {#if event.reason}<p class="reason">Why: {event.reason}</p>{/if}
        </li>
      {/each}
    </ol>
  </details>
{/if}

<style>
  .change-log {
    margin: 0.75rem 0;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
  }
  li {
    padding: 0.25rem 0;
  }
  li p {
    margin: 0.125rem 0;
  }
  .reason {
    font-style: italic;
  }
</style>
