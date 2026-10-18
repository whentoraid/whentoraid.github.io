<script>
  import { app } from '../lib/app.svelte.js'
  import { memberById } from '../lib/model.js'
  import { loadRecordFlags, recordFlags, resolveFlag } from '../lib/record-flags.svelte.js'
  import { formatMonthDay } from '../lib/time.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * Officers, online guilds (M08): players' reports of a mistake in their raid record. Correcting the
   * record happens in the planner; resolving here records which officer reviewed it.
   */
  $effect(() => {
    void loadRecordFlags()
  })
  const open = $derived(recordFlags.rows.filter((flag) => flag.status === 'open'))
  const raidName = (raidId) => app.data.settings.raids.find((raid) => raid.id === raidId)?.name ?? raidId
  const playerName = (memberId) => memberById(app.data, memberId)?.name ?? 'A former member'

  let replying = $state(null)
  let reply = $state('')
  let busy = $state(false)

  function openAttendance(flag) {
    app.data = { ...app.data, currentWeek: flag.week, currentRaidId: flag.raid_id }
    app.plannerIntent = { section: 'roster', focus: 'attendance' }
    app.view = 'planner'
  }

  async function resolve(flag) {
    busy = true
    try {
      await resolveFlag(flag.id, reply.trim())
      replying = null
      reply = ''
      showToast(`${playerName(flag.member_id)} can now see that you reviewed their report.`)
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
    }
  }
</script>

{#if open.length || recordFlags.error}
  <section class="panel record-corrections" aria-label="Record corrections">
    <span class="eyebrow gold">RECORD CORRECTIONS</span>
    <h2>{open.length === 1 ? '1 player reported a mistake' : `${open.length} players reported a mistake`}</h2>
    <p class="note">
      A report never changes attendance. Fix the record in the planner if it’s wrong, then mark the report
      reviewed so the player knows.
    </p>
    {#if recordFlags.error}
      <p class="warning" role="alert">Reports could not be loaded: {recordFlags.error}</p>
    {/if}
    <ul>
      {#each open as flag (flag.id)}
        <li>
          <div>
            <strong>{playerName(flag.member_id)}</strong> · {raidName(flag.raid_id)}, week of {formatMonthDay(
              flag.week,
            )}
            <p>“{flag.note}”</p>
          </div>
          {#if replying === flag.id}
            <form
              onsubmit={(event) => {
                event.preventDefault()
                void resolve(flag)
              }}
            >
              <label class="field">
                Reply to {playerName(flag.member_id)} (optional)
                <textarea bind:value={reply} maxlength="500" rows="2"></textarea>
              </label>
              <div class="buttons">
                <button class="primary" disabled={busy}>Mark reviewed</button>
                <button type="button" onclick={() => (replying = null)}>Cancel</button>
              </div>
            </form>
          {:else}
            <div class="buttons">
              <button onclick={() => openAttendance(flag)}>Open attendance</button>
              <button
                onclick={() => {
                  replying = flag.id
                  reply = ''
                }}>Mark reviewed</button
              >
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .record-corrections {
    margin-top: 24px;
  }
  ul {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    gap: 0.5rem;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  li:last-child {
    border-bottom: 0;
  }
  li p {
    margin: 4px 0 0;
  }
</style>
