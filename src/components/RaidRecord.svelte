<script>
  import { app } from '../lib/app.svelte.js'
  import { RECORD_LOOKBACK_WEEKS } from '../lib/attendance.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { tracksAttendance } from '../lib/model.js'
  import { BENCH_LOOKBACK_WEEKS } from '../lib/planning.js'
  import {
    fairnessSummary,
    latestFlag,
    OUTCOMES,
    personalRecord,
    PRIORITY_EXPLANATIONS,
  } from '../lib/raid-record.js'
  import { flagRecord, loadRecordFlags, recordFlags, recordFlagsOnline } from '../lib/record-flags.svelte.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { memberById } from '../lib/model.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * M08: the player's own recent raids and the sit-out count the planner uses for them. Only the
   * player's own record is shown here. Online, a player can report a mistake for officers to review;
   * the report never changes the record by itself.
   */
  let { memberId, thisWeek, now } = $props()

  const canFlag = $derived(recordFlagsOnline() && remote.memberId === memberId)
  $effect(() => {
    if (canFlag) void loadRecordFlags()
  })
  const flagOf = (row) => (canFlag ? latestFlag(recordFlags.rows, row.weekIso, row.raidId, memberId) : null)
  const officerName = (id) => memberById(app.data, id)?.name ?? 'An officer'

  let reporting = $state(null)
  let note = $state('')
  let busy = $state(false)
  const rowKey = (row) => `${row.weekIso}:${row.raidId}`

  async function report(row) {
    busy = true
    try {
      await flagRecord(row.weekIso, row.raidId, note.trim())
      reporting = null
      note = ''
      showToast('Sent to your officers. The record stays as it is until they review it.')
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
    }
  }

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
      {#each rows as row (rowKey(row))}
        {@const flag = flagOf(row)}
        <li>
          <span class="when">{day(row.start)}</span>
          <span class="what">{row.raidName}</span>
          <span class="outcome">
            {label(row)}{#if row.countsForFairness}<span class="badge">counts toward fairness</span>{/if}
          </span>
          {#if flag?.status === 'open'}
            <p class="flag note">You reported: “{flag.note}” Waiting for officers to review it.</p>
          {:else if flag}
            <p class="flag note">
              {officerName(flag.resolved_by)} reviewed your report{flag.reply ? `: “${flag.reply}”` : '.'}
            </p>
          {/if}
          {#if canFlag && flag?.status !== 'open'}
            {#if reporting === rowKey(row)}
              <form
                class="flag"
                onsubmit={(event) => {
                  event.preventDefault()
                  void report(row)
                }}
              >
                <label class="field">
                  What looks wrong?
                  <textarea bind:value={note} maxlength="500" rows="2" required></textarea>
                </label>
                <div class="buttons">
                  <button class="primary" disabled={busy || !note.trim()}>Send to officers</button>
                  <button type="button" onclick={() => (reporting = null)}>Cancel</button>
                </div>
              </form>
            {:else}
              <button
                class="text-button flag"
                aria-label={`Report a mistake for ${row.raidName}, ${day(row.start)}`}
                onclick={() => {
                  reporting = rowKey(row)
                  note = ''
                }}>Report a mistake</button
              >
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    {#if canFlag && recordFlags.error}
      <p class="warning" role="alert">Your reports could not be loaded: {recordFlags.error}</p>
    {/if}
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
  .rows .flag {
    grid-column: 1 / -1;
    margin: 0;
    justify-self: start;
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
