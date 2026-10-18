<script>
  import { app } from '../lib/app.svelte.js'
  import { RECORD_LOOKBACK_WEEKS } from '../lib/attendance.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { tracksAttendance } from '../lib/model.js'
  import { BENCH_LOOKBACK_WEEKS } from '../lib/planning.js'
  import { fairnessSummary, OUTCOMES, personalRecord, PRIORITY_EXPLANATIONS } from '../lib/raid-record.js'

  /**
   * M08: the player's own recent raids and the sit-out count the planner uses for them. Only the
   * player's own record is shown here.
   */
  let { memberId, thisWeek, now } = $props()

  const rows = $derived(personalRecord(app.data, memberId, thisWeek, now))
  const fairness = $derived(fairnessSummary(app.data, memberId, thisWeek))
  const counted = $derived(fairness.reduce((sum, raid) => sum + raid.satOut, 0))
  const tracked = $derived(tracksAttendance(app.data))
  const label = (row) => (row.outcome === 'rostered' && !tracked ? 'On the roster' : OUTCOMES[row.outcome])
  const day = (instant) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: viewerZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(instant)
  const times = (n) => (n === 1 ? 'once' : `${n} times`)
</script>

{#if rows.length}
  <details class="panel raid-record">
    <summary>
      Your recent raids<span class="summary-state">
        · {counted ? `${times(counted)} sat out recently` : 'no recent sit-outs'}</span
      >
    </summary>

    <h3>How sitting out is counted</h3>
    <ul class="fairness">
      {#each fairness as raid (raid.raidId)}
        <li>
          <strong>{raid.raidName}:</strong>
          {raid.satOut
            ? `you sat out ${times(raid.satOut)} in the ${BENCH_LOOKBACK_WEEKS} weeks before this one.`
            : `no sit-outs in the ${BENCH_LOOKBACK_WEEKS} weeks before this one.`}
          {PRIORITY_EXPLANATIONS[raid.priority]}
        </li>
      {/each}
    </ul>
    <p class="note">
      A sit-out is a raid you were free for and offered a character, but weren’t picked for. It only breaks
      ties between rosters that are otherwise equal. It doesn’t measure skill or effort, doesn’t promise a
      place, and officers can still choose by hand.
    </p>

    <h3>Last {RECORD_LOOKBACK_WEEKS} weeks</h3>
    <ul class="rows">
      {#each rows as row (`${row.weekIso}:${row.raidId}`)}
        <li>
          <span class="when">{day(row.start)}</span>
          <span class="what">{row.raidName}</span>
          <span class="outcome">
            {label(row)}{#if row.countsForFairness}<span class="badge">counts toward fairness</span>{/if}
          </span>
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .raid-record summary {
    cursor: pointer;
    font-weight: 600;
  }
  .summary-state {
    color: var(--muted);
    font-weight: 400;
  }
  h3 {
    margin: 1rem 0 0.5rem;
    font-size: 15px;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .fairness li {
    margin-bottom: 0.5rem;
  }
  .rows li {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr) minmax(0, 1.4fr);
    gap: 0.75rem;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .when {
    color: var(--muted);
  }
  .badge {
    margin-left: 0.5rem;
  }
  @media (max-width: 600px) {
    .rows li {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }
</style>
