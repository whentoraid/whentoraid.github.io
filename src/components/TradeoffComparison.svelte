<script>
  import { app } from '../lib/app.svelte.js'
  import { formatDateIn, formatTimesIn } from '../lib/grid.js'
  import { memberById } from '../lib/model.js'
  import { BENCH_LOOKBACK_WEEKS } from '../lib/planning.js'
  import { compareSuggestions, officerChanges } from '../lib/tradeoffs.js'

  /**
   * M09: the top window side by side with an alternative, using the planner's real ranking, and
   * the officer's own roster edits kept apart from what the planner suggested.
   * `suggestions` are the top windows (best first); `all` every ranked window.
   */
  let { suggestions, all, savedPlan, players, zone, priorityLabel } = $props()

  let picked = $state(1)
  const first = $derived(suggestions[0])
  const other = $derived(suggestions[Math.min(picked, suggestions.length - 1)])
  const comparison = $derived(first && other && other !== first ? compareSuggestions(first, other) : null)
  const name = (id) => memberById(app.data, id)?.name ?? 'Former member'
  const sitOuts = (id) => players.find((p) => p.id === id)?.priority ?? 0
  const withSitOuts = (id) => {
    const n = sitOuts(id)
    return n ? `${name(id)} (sat out ${n})` : name(id)
  }
  const label = (s) => `${formatDateIn(s, zone)}, ${formatTimesIn(s, zone)}`

  const savedSuggestion = $derived(savedPlan && all.find((s) => s.start === savedPlan.start))
  const edits = $derived(officerChanges(savedPlan?.team, savedSuggestion))
</script>

{#if comparison}
  <details class="disclosure tradeoffs">
    <summary><span>Compare windows</span><small>Why the top suggestion ranks first</small></summary>
    <div class="disclosure-content">
      <label class="field">
        Compare the top suggestion with
        <select bind:value={picked}>
          {#each suggestions.slice(1) as s, i (s.start)}<option value={i + 1}>{label(s)}</option>{/each}
        </select>
      </label>

      <p>
        <strong>{label(first)}</strong> ranks first because of
        <strong>{comparison.decidedBy?.toLowerCase()}</strong>.
      </p>

      <table>
        <thead>
          <tr>
            <th scope="col">Ranking rule, in order</th>
            <th scope="col">Top</th>
            <th scope="col">This one</th>
          </tr>
        </thead>
        <tbody>
          {#each comparison.rows as row (row.key)}
            <tr class:decisive={row.decisive}>
              <th scope="row"
                >{row.label}{#if row.decisive}<span class="badge">decides</span>{/if}</th
              >
              <td>{row.first}</td>
              <td>{row.other}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="note">
        Each rule only counts when every rule above it is equal; an earlier start breaks a full tie. Within
        one window, players with otherwise equal rosters are picked by: {priorityLabel}. Sit-outs count the
        last
        {BENCH_LOOKBACK_WEEKS} weeks.
      </p>

      <h3>Choosing {label(other)} instead</h3>
      {#if !comparison.joins.length && !comparison.leaves.length}
        <p>The same players would be rostered.</p>
      {:else}
        {#if comparison.joins.length}<p>Joins: {comparison.joins.map(withSitOuts).join(', ')}</p>{/if}
        {#if comparison.leaves.length}<p>Drops out: {comparison.leaves.map(withSitOuts).join(', ')}</p>{/if}
      {/if}

      {#if edits}
        <h3>Your changes to the suggestion</h3>
        <p class="note">These are officer choices, not the planner's ranking.</p>
        {#if edits.added.length}<p>Added by hand: {edits.added.map(name).join(', ')}</p>{/if}
        {#if edits.removed.length}<p>Left off by hand: {edits.removed.map(withSitOuts).join(', ')}</p>{/if}
      {/if}
    </div>
  </details>
{/if}

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0;
  }
  th,
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    font-weight: 400;
  }
  td {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  thead th {
    color: var(--muted);
    font-size: 12px;
  }
  tr.decisive th,
  tr.decisive td {
    color: var(--gold);
    font-weight: 600;
  }
  .badge {
    margin-left: 0.5rem;
  }
  h3 {
    margin: 1rem 0 0.25rem;
    font-size: 15px;
  }
</style>
