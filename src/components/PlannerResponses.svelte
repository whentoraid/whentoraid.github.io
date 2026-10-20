<script>
  import RaidResponsesPanel from './RaidResponsesPanel.svelte'
  import SignupsPanel from './SignupsPanel.svelte'
  import StandbyOffersPanel from './StandbyOffersPanel.svelte'
  import { loadRaidResponses, responseKey } from '../lib/raid-responses.svelte.js'
  import { standbyOnline } from '../lib/standby.svelte.js'
  import { usesServerDelivery } from '../lib/discord-delivery.svelte.js'

  /**
   * The planner's Responses tab, for officers: sign-ups, how players answered the published roster
   * (republishing asks everyone again) and standby offers. `active` is whether the tab is on screen.
   */
  let {
    week,
    raidId,
    published,
    cancelled,
    active,
    zone,
    canReplace,
    onreplace,
    canPlaceOffer,
    onplaceoffer,
    onreviewdraft,
  } = $props()

  let responses = $state({ key: null, byMember: {}, error: '', checkedAt: null })
  let checking = $state(false)
  /** Bumped to fetch again: responses are not part of live guild sync. */
  let tick = $state(0)
  const key = $derived(published ? responseKey(week, raidId, published) : null)
  $effect(() => {
    const current = key
    void tick
    if (!current) return
    checking = true
    loadRaidResponses(week, raidId, published)
      .then((byMember) => {
        if (current === key) responses = { key: current, byMember, error: '', checkedAt: Date.now() }
      })
      .catch((error) => {
        // Keep the last answers on screen when a background refresh fails.
        if (current === key)
          responses = {
            ...responses,
            key: current,
            byMember: responses.key === current ? responses.byMember : {},
            error: error.message,
          }
      })
      .finally(() => {
        if (current === key) checking = false
      })
  })
  /** Check again every minute while officers watch the Responses tab and the page is visible. */
  const REFRESH_MS = 60_000
  $effect(() => {
    if (!active || !key) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') tick += 1
    }, REFRESH_MS)
    return () => clearInterval(timer)
  })
</script>

<svelte:window onfocus={() => (tick += 1)} />

{#if usesServerDelivery()}
  <SignupsPanel {week} {raidId} canManage={true} />
{/if}
{#if published && !cancelled}
  {#if responses.key === key}
    <RaidResponsesPanel
      team={published.team}
      byMember={responses.byMember}
      error={responses.error}
      checkedAt={responses.checkedAt}
      {checking}
      {zone}
      {canReplace}
      {onreplace}
      onrefresh={() => (tick += 1)}
    />
    {#if standbyOnline()}
      <StandbyOffersPanel
        {week}
        {raidId}
        {published}
        byMember={responses.byMember}
        canPlace={canPlaceOffer}
        onplace={onplaceoffer}
      />
    {/if}
  {:else}<p role="status">Loading player responses…</p>{/if}
{:else}<div class="panel empty-state">
    <h2>{cancelled ? 'This raid is cancelled' : 'Publish before collecting responses'}</h2>
    <p>
      {cancelled
        ? 'Restore the raid to review player responses.'
        : 'When the roster is published, players can confirm their place or tell you they can’t make it.'}
    </p>
    {#if !cancelled}<button onclick={onreviewdraft}>Review the draft roster</button>{/if}
  </div>{/if}
