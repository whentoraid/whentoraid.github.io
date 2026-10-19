<script>
  import { app } from '../lib/app.svelte.js'
  import { memberById } from '../lib/model.js'
  import { describeChange, formatWhen, restorePreview, restoreRoster } from '../lib/raid-history.js'
  import { explainRaidChange, getRaidHistory } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { flushOnlineChanges, remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * M13, officers of an online guild: who changed this raid, when, and why, and the roster from
   * before a change restored as a new draft after a preview. Publishing it is still up to them.
   */
  let { weekIso, raidId, zone } = $props()

  let events = $state([])
  let error = $state('')
  let loading = $state(false)
  let open = $state(false)
  /** The change whose earlier roster is being previewed, and its preview. */
  let restoring = $state(null)
  let explaining = $state(null)
  let reason = $state('')

  async function load() {
    const key = `${weekIso}|${raidId}`
    loading = true
    try {
      const rows = await getRaidHistory(supabase, remote.guildId, weekIso, raidId)
      if (key !== `${weekIso}|${raidId}`) return
      events = rows ?? []
      error = ''
    } catch (e) {
      error = e.message
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void weekIso
    void raidId
    restoring = null
    explaining = null
    if (open) load()
  })

  const name = (id) => memberById(app.data, id)?.name ?? 'A former player'

  function preview(event) {
    restoring = { id: event.id, preview: restorePreview(app.data, weekIso, raidId, event.before) }
  }

  async function restore() {
    const { preview: result } = restoring
    app.data = restoreRoster(app.data, weekIso, raidId, result)
    restoring = null
    showToast('Earlier roster restored as the draft. Review it, then publish when you’re ready.')
    try {
      await flushOnlineChanges()
    } catch {
      // The sync notice explains an unsaved edit.
    }
    load()
  }

  function startExplaining(event) {
    explaining = event.id
    reason = event.reason ?? ''
  }

  async function saveReason(event) {
    event.preventDefault()
    try {
      await explainRaidChange(supabase, remote.guildId, explaining, reason)
      explaining = null
      load()
    } catch (e) {
      showToast(e.message)
    }
  }
</script>

<details class="panel raid-history" bind:open>
  <summary><span>Raid history</span><small>Who changed this raid, and why</small></summary>
  {#if error}
    <p class="warning" role="alert">
      Couldn’t load the history: {error} <button onclick={load}>Try again</button>
    </p>
  {:else if loading && !events.length}
    <p role="status">Loading the history…</p>
  {:else if !events.length}
    <p class="note">No changes recorded yet. Changes are kept for six months.</p>
  {/if}
  <ol class="history">
    {#each events as event (event.id)}
      {@const text = describeChange(event, app.data, zone)}
      <li>
        <div class="history-heading">
          <strong>{text.headline}</strong>
          <small
            >{formatWhen(event.at, zone)}{event.visibility === 'members' ? ' · players see this' : ''}</small
          >
        </div>
        {#if text.lines.length}<ul>
            {#each text.lines as line, i (i)}<li>{line}</li>{/each}
          </ul>{/if}
        {#if event.reason}<p class="reason">Why: {event.reason}</p>{/if}

        {#if explaining === event.id}
          <form onsubmit={saveReason}>
            <label class="field"
              >Why was this changed? (optional)<input maxlength="300" bind:value={reason} /></label
            >
            <div class="buttons">
              <button class="primary">Save reason</button>
              <button type="button" onclick={() => (explaining = null)}>Cancel</button>
            </div>
          </form>
        {:else if restoring?.id === event.id}
          <div class="restore" role="status">
            {#if restoring.preview.error}
              <p class="warning">{restoring.preview.error}</p>
              <button onclick={() => (restoring = null)}>Close</button>
            {:else}
              {@const p = restoring.preview}
              <p>
                Restoring makes this the draft roster ({p.team.length}
                {p.team.length === 1 ? 'player' : 'players'}). The published roster, player responses and
                attendance stay as they are.
              </p>
              {#if p.joins.length}<p>Back on the draft: {p.joins.map(name).join(', ')}</p>{/if}
              {#if p.leaves.length}<p>Off the draft: {p.leaves.map(name).join(', ')}</p>{/if}
              {#if p.dropped.length}
                <p class="warning">Can’t be restored:</p>
                <ul>
                  {#each p.dropped as { entry, reason: why } (entry.memberId + entry.characterId)}
                    <li>{name(entry.memberId)}: {why}</li>
                  {/each}
                </ul>
              {/if}
              {#if p.timeKept}<p class="note">The raid keeps its current time.</p>{/if}
              <div class="buttons">
                <button class="primary" onclick={restore}>Restore as draft</button>
                <button onclick={() => (restoring = null)}>Cancel</button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="buttons">
            {#if event.before?.team?.length}
              <button class="text-button" onclick={() => preview(event)}
                >Restore the roster from before this</button
              >
            {/if}
            <button class="text-button" onclick={() => startExplaining(event)}
              >{event.reason ? 'Edit reason' : 'Add a reason'}</button
            >
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</details>

<style>
  .history {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
  }
  .history > li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line, #ffffff14);
  }
  .history-heading {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    align-items: baseline;
  }
  .history ul {
    margin: 0.25rem 0;
    padding-left: 1.25rem;
  }
  .reason {
    margin: 0.25rem 0;
    font-style: italic;
  }
  .restore {
    margin-top: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-left: 2px solid var(--gold);
  }
</style>
