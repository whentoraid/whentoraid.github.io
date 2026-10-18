<script>
  import { viewerZone } from '../lib/display.svelte.js'
  import { briefingFor, isRaidDay, meetUpTime, safeVoiceLink } from '../lib/raid-briefing.js'
  import { briefings, briefingsOnline, loadBriefings } from '../lib/raid-briefing.svelte.js'

  /**
   * M15: the officers' raid-day details for the player's next raid. Close to the raid it opens as a
   * compact "Raid day" block; earlier it stays folded. Nothing shows when the guild set none.
   */
  let { item, now } = $props()

  $effect(() => {
    if (briefingsOnline()) loadBriefings()
  })

  const briefing = $derived(briefingFor(briefings.data, item.weekIso, item.raidId))
  const raidDay = $derived(isRaidDay(item.session, now))
  const meetAt = $derived(briefing && meetUpTime(item.session.start, briefing.assemblyMinutes, viewerZone))
  const voice = $derived(briefing && safeVoiceLink(briefing.voiceUrl))
</script>

{#snippet details()}
  <dl class="briefing-list">
    {#if meetAt || briefing.location}
      <dt>Meet up</dt>
      <dd>
        {#if meetAt}<strong>{meetAt}</strong> ({briefing.assemblyMinutes} min before start){/if}{#if meetAt && briefing.location}
          ·
        {/if}{briefing.location ?? ''}
      </dd>
    {/if}
    {#if voice}
      <dt>Voice chat</dt>
      <dd>
        <a href={voice.href} target="_blank" rel="noopener noreferrer"
          >Join voice chat <small>({voice.host})</small></a
        >
      </dd>
    {/if}
    {#if briefing.contact}
      <dt>Problems?</dt>
      <dd>Contact {briefing.contact}</dd>
    {/if}
    {#if briefing.notes}
      <dt>Bring / prepare</dt>
      <dd class="pre">{briefing.notes}</dd>
    {/if}
    {#if briefing.weekNote}
      <dt>This week</dt>
      <dd class="pre">{briefing.weekNote}</dd>
    {/if}
  </dl>
{/snippet}

{#if briefing}
  {#if raidDay}
    <section class="briefing raid-day" aria-label="Raid day">
      <span class="eyebrow">RAID DAY</span>
      {@render details()}
    </section>
  {:else}
    <details class="briefing">
      <summary>Raid-day details</summary>
      {@render details()}
    </details>
  {/if}
{/if}

<style>
  .briefing {
    margin: 0.75rem 0;
    padding: 0.75rem;
    border-left: 2px solid var(--gold);
  }
  .briefing-list {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 0.75rem;
    margin: 0.5rem 0 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .pre {
    white-space: pre-line;
  }
  @media (max-width: 480px) {
    .briefing-list {
      grid-template-columns: 1fr;
    }
    dd {
      margin-bottom: 0.25rem;
    }
  }
</style>
