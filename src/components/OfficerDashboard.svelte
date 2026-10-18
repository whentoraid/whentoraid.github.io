<script>
  import { app } from '../lib/app.svelte.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { formatDateIn } from '../lib/grid.js'
  import {
    attentionCount,
    CHECKIN_ACTION,
    officerDashboard,
    RESPONSES_ACTION,
  } from '../lib/officer-dashboard.js'
  import { formatClock, formatMonthDay, wallTime } from '../lib/time.js'

  /** Officers: upcoming raids across the next few weeks and what each still needs. */
  let { now } = $props()

  const weeks = $derived(officerDashboard(app.data, now))
  const needing = $derived(attentionCount(weeks))
  const zone = $derived(displayZone(app.data.guild))
  const STATUS_LABELS = {
    unplanned: 'Not planned',
    draft: 'Draft',
    published: 'Published',
    cancelled: 'Cancelled',
  }

  const when = (start) =>
    start === null
      ? 'No time chosen'
      : `${formatDateIn({ start }, zone)} · ${formatClock(wallTime(start, zone).minutes)}`

  const rowKey = (weekIso, raidId = '') => `${weekIso}/${raidId}`

  /**
   * Open the planner at this raid and week, at the tool an issue names (or the planner's default),
   * remembering the row so the planner can lead back to it.
   */
  function open(weekIso, raidId, intent = null) {
    app.data = { ...app.data, currentWeek: weekIso, currentRaidId: raidId ?? app.data.currentRaidId }
    app.plannerIntent = intent
    app.returnTo = rowKey(weekIso, raidId)
    app.view = 'planner'
  }

  // Back from the planner: bring the row the officer left from into view, with its updated state.
  let list = $state()
  $effect(() => {
    const key = app.dashboardFocus
    if (!key || !list) return
    app.dashboardFocus = null
    const row = [...list.querySelectorAll('[data-row]')].find((el) => el.dataset.row === key)
    row?.scrollIntoView?.({ block: 'center' })
    row?.querySelector('button')?.focus({ preventScroll: true })
  })
</script>

<section class="panel officer-dashboard" aria-label="Officer dashboard" bind:this={list}>
  <div class="heading">
    <div>
      <span class="eyebrow gold">OFFICER DASHBOARD</span>
      <h2>Upcoming raids</h2>
    </div>
    <span class="badge" class:success={needing === 0} role="status"
      >{needing === 0 ? 'Nothing needs attention' : `${needing} need attention`}</span
    >
  </div>
  {#each weeks.filter((week) => week.raids.length) as week (week.weekIso)}
    <h3 data-row={rowKey(week.weekIso)}>
      Week of {formatMonthDay(week.weekIso)}
      {#if week.waiting}<small>· {week.waiting} not checked in</small>
        <button
          class="text-button fix"
          onclick={() => open(week.weekIso, null, CHECKIN_ACTION.intent)}
          aria-label={`${CHECKIN_ACTION.label}, week of ${formatMonthDay(week.weekIso)}`}
          >{CHECKIN_ACTION.label}</button
        >{/if}
    </h3>
    <ul>
      {#each week.raids as raid (raid.raidId)}
        <li data-row={rowKey(raid.weekIso, raid.raidId)}>
          <div class="what">
            <strong>{raid.raidName}</strong>
            <small>{when(raid.start)} · {STATUS_LABELS[raid.status]}</small>
          </div>
          <div class="issues">
            {#if raid.issues.length}
              <ul class="issue-list">
                {#each raid.issues as issue, i (i)}<li>
                    <span>{issue.message}</span>
                    <button
                      class="text-button fix"
                      onclick={() => open(raid.weekIso, raid.raidId, issue.action.intent)}
                      aria-label={`${issue.action.label}: ${raid.raidName}, ${issue.message}`}
                      >{issue.action.label}</button
                    >
                  </li>{/each}
              </ul>
            {:else if raid.status !== 'cancelled'}
              <span class="ok">Ready</span>
            {/if}
            {#if raid.status === 'published'}<button
                class="text-button fix"
                onclick={() => open(raid.weekIso, raid.raidId, RESPONSES_ACTION.intent)}
                aria-label={`${RESPONSES_ACTION.label}: ${raid.raidName}, week of ${formatMonthDay(raid.weekIso)}`}
                >{RESPONSES_ACTION.label}</button
              >{/if}
          </div>
          <button
            onclick={() => open(raid.weekIso, raid.raidId)}
            aria-label={`Open ${raid.raidName}, week of ${formatMonthDay(raid.weekIso)}`}>Open</button
          >
        </li>
      {/each}
    </ul>
  {/each}
</section>

<style>
  .officer-dashboard {
    margin-bottom: 24px;
    border-top: 2px solid var(--gold);
  }
  .heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  h3 {
    margin: 1.25rem 0 0.25rem;
    font-size: 14px;
  }
  h3 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 0.5rem;
  }
  h3 small {
    display: inline;
    font-weight: normal;
    color: var(--muted);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line);
  }
  .what {
    flex: 1 1 12rem;
    display: grid;
  }
  .what small {
    color: var(--muted);
  }
  .issues {
    flex: 2 1 16rem;
  }
  .issue-list li {
    align-items: baseline;
    padding: 0;
    border: 0;
    gap: 0 0.75rem;
    color: var(--red);
    font-size: 13px;
  }
  .issue-list li span::before {
    content: '• ';
  }
  .fix {
    margin-top: 0;
    padding-block: 0.25rem;
    font-size: 13px;
    font-weight: normal;
  }
  .ok {
    color: var(--green);
    font-size: 13px;
  }
</style>
