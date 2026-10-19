<script>
  import { app } from '../lib/app.svelte.js'
  import { APPLICABLE } from '../lib/remote/recovery.js'
  import {
    discardUnsavedChange,
    dismissUnsavedDraft,
    downloadUnsavedDraft,
    reapplyUnsavedDraft,
    remote,
  } from '../lib/remote/sync.svelte.js'

  /**
   * M12: an online edit that did not save, shown task by task: what is online now beside what was
   * tried, and whether it can still be applied. Each change can be discarded on its own; saving
   * again applies only the changes that still can be, after confirming any that replace someone
   * else's newer version.
   */
  const OUTCOMES = {
    ready: 'Ready to save again',
    conflict: 'Changed online too',
    saved: 'Already saved',
    gone: 'Can’t be saved',
    forbidden: 'Can’t be saved',
    closed: 'Can’t be saved',
  }
  const VIEWS = {
    availability: 'availability',
    usual: 'availability',
    character: 'characters',
    roster: 'planner',
  }

  let confirming = $state(false)
  const changes = $derived(remote.changes)
  const applicable = $derived(changes.filter((change) => APPLICABLE.has(change.outcome)))
  const conflicts = $derived(applicable.filter((change) => change.outcome === 'conflict').length)

  function save() {
    if (conflicts && !confirming) {
      confirming = true
      return
    }
    reapplyUnsavedDraft()
    confirming = false
  }

  function discardAll() {
    dismissUnsavedDraft()
    confirming = false
  }

  /** Open the page for this task beneath the notice, showing the online version. */
  function review(change) {
    const view = VIEWS[change.task]
    if (!view) return
    app.data = { ...app.data, ...(change.week ? { currentWeek: change.week } : {}) }
    app.view = view
  }
</script>

<section class="unsaved-notice" role="alert">
  {#if changes.length}
    <strong
      >{changes.length === 1
        ? 'One change was not saved online.'
        : `${changes.length} changes were not saved online.`}</strong
    >
    <p>The page now shows the online version. Here is what you tried to change.</p>
    <ul class="changes">
      {#each changes as change (change.id)}
        <li>
          <div class="change-heading">
            <strong>{change.title}</strong>
            <span class="badge" class:warning={!APPLICABLE.has(change.outcome)}
              >{OUTCOMES[change.outcome]}</span
            >
          </div>
          {#if change.differences.length}
            <table>
              <thead>
                <tr><th scope="col"></th><th scope="col">Online now</th><th scope="col">Your change</th></tr>
              </thead>
              <tbody>
                {#each change.differences as difference, i (i)}
                  <tr>
                    <th scope="row">{difference.label}</th>
                    <td>{difference.online}</td>
                    <td>{difference.yours}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          <p class="note">{change.reason}</p>
          <div class="buttons">
            {#if VIEWS[change.task]}
              <button class="text-button" onclick={() => review(change)}>Review online version</button>
            {/if}
            <button class="text-button" onclick={() => discardUnsavedChange(change.id)}
              >Discard this change</button
            >
          </div>
        </li>
      {/each}
    </ul>
    <div class="buttons">
      {#if applicable.length}
        <button class="primary" onclick={save}
          >{confirming
            ? `Replace the online version (${conflicts})`
            : applicable.length === 1
              ? 'Save this change again'
              : `Save ${applicable.length} changes again`}</button
        >
      {/if}
      <button onclick={downloadUnsavedDraft}>Download unsaved edit</button>
      <button onclick={discardAll}>Discard {changes.length === 1 ? 'it' : 'all'}</button>
    </div>
    {#if confirming}
      <p class="note">
        {conflicts === 1 ? 'One change replaces' : `${conflicts} changes replace`} what someone else saved after
        you started.
      </p>
    {/if}
  {:else}
    <strong>Your last online edit was not saved.</strong>
    <p>
      {remote.status === 'stale'
        ? 'The latest online version is still loading.'
        : 'The current guild has been reloaded.'} Download your edit for safekeeping, or reapply it over the current
      online version.
    </p>
    <div class="buttons">
      <button onclick={downloadUnsavedDraft}>Download unsaved edit</button>
      {#if confirming}
        <button
          class="primary"
          onclick={() => {
            reapplyUnsavedDraft()
            confirming = false
          }}>Confirm reapply</button
        >
      {:else}
        <button onclick={() => (confirming = true)}>Reapply my edit</button>
      {/if}
      <button onclick={discardAll}>Discard unsaved edit</button>
    </div>
  {/if}
</section>

<style>
  .changes {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
  }
  .changes li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line, #ffffff14);
  }
  .change-heading {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    align-items: center;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.25rem 0;
    font-size: 0.9rem;
  }
  th,
  td {
    padding: 4px 6px;
    text-align: left;
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  thead th {
    color: var(--muted);
    font-size: 12px;
  }
</style>
