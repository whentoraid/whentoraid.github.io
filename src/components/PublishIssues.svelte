<script>
  import { app } from '../lib/app.svelte.js'
  import { ROLES } from '../lib/constants.js'
  import { memberById } from '../lib/model.js'

  /**
   * What stops the draft from being published, each with the tool that resolves it. `ondialog`
   * opens the planner's player or add-player dialog; `onopenoverlap` switches to the other raid.
   */
  let { issues, ondialog, onrestore, onopenoverlap } = $props()
</script>

<section role="alert" class="publication-review">
  <h3 id="publish-check" tabindex="-1">Resolve before publishing</h3>
  <ul>
    {#each issues as issue, i (i)}
      <li>
        <span>{issue.message}</span>
        {#if issue.memberId}
          <button onclick={() => ondialog({ kind: 'player', memberId: issue.memberId })}
            >Review {memberById(app.data, issue.memberId)?.name ?? 'player'}</button
          >
        {:else if issue.kind === 'capacity'}
          <button onclick={() => ondialog({ kind: 'add', role: issue.role })}
            >Review {issue.role} slots</button
          >
        {:else if issue.kind === 'empty'}
          <button onclick={() => ondialog({ kind: 'add', role: ROLES[0] })}>Add a player</button>
        {:else if issue.kind === 'cancelled'}
          <button onclick={onrestore}>Restore raid</button>
        {/if}
        {#if issue.kind === 'overlap'}
          <button onclick={() => onopenoverlap(issue)}>Open overlapping raid</button>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .publication-review {
    margin: 1rem 0;
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--gold);
    background: #ffffff05;
  }
  .publication-review li {
    margin: 0.5rem 0;
  }
  .publication-review li button {
    margin: 0.25rem;
  }
</style>
