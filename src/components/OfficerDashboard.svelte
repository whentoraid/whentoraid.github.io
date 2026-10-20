<script>
  import { app } from '../lib/app.svelte.js'
  import Icon from './Icon.svelte'
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
  const raids = $derived(weeks.flatMap((week) => week.raids))
  const publishedCount = $derived(raids.filter((raid) => raid.status === 'published').length)
  const checkedIn = $derived(app.data.members.length - (weeks[0]?.waiting ?? 0))
  let filter = $state('all')
  const visibleWeeks = $derived(
    weeks
      .map((week) => ({
        ...week,
        raids: week.raids.filter(
          (raid) =>
            filter === 'all' ||
            (filter === 'attention' ? raid.issues.length > 0 : raid.status === 'published'),
        ),
      }))
      .filter((week) => week.raids.length),
  )
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

<section class="officer-dashboard" aria-label="Officer dashboard" bind:this={list}>
  <div class="workload" aria-label="Raid workload">
    <button class:chosen={filter === 'all'} aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>
      <span class="metric-label"><Icon name="calendar" size={18} /> Upcoming raids</span>
      <strong>{raids.length}<Icon name="arrow" size={18} /></strong><small>Across the next four weeks</small>
    </button>
    <button
      class="attention"
      class:chosen={filter === 'attention'}
      aria-pressed={filter === 'attention'}
      onclick={() => (filter = 'attention')}
    >
      <span class="metric-label"><Icon name="alert" size={18} /> Needs attention</span>
      <strong>{needing}<Icon name="arrow" size={18} /></strong><small>Raids with a next step</small>
    </button>
    <button
      class="published-metric"
      class:chosen={filter === 'published'}
      aria-pressed={filter === 'published'}
      onclick={() => (filter = 'published')}
    >
      <span class="metric-label"><Icon name="shield" size={18} /> Published</span>
      <strong>{publishedCount}<Icon name="arrow" size={18} /></strong><small
        >Rosters shared with players</small
      >
    </button>
    <div class="checkin-metric">
      <span class="metric-label"><Icon name="members" size={18} /> This week’s check-ins</span>
      <strong>{checkedIn}<span> / {app.data.members.length}</span></strong>
      <div class="metric-track" aria-hidden="true">
        <span style:width={`${app.data.members.length ? (checkedIn / app.data.members.length) * 100 : 0}%`}
        ></span>
      </div>
      <small>{weeks[0]?.waiting ?? 0} players still to answer</small>
    </div>
  </div>

  <div class="heading">
    <div>
      <span class="eyebrow gold">RAID OPERATIONS</span>
      <h2>Upcoming raids</h2>
    </div>
    <span class="badge" class:success={needing === 0} role="status"
      >{needing === 0 ? 'Nothing needs attention' : `${needing} need attention`}</span
    >
  </div>
  <p class="filter-summary" role="status">
    {filter === 'all'
      ? 'All upcoming raids'
      : filter === 'attention'
        ? 'Showing raids that need attention'
        : 'Showing published rosters'}
    {#if filter !== 'all'}<button class="text-button" onclick={() => (filter = 'all')}>Show all raids</button
      >{/if}
  </p>
  {#each visibleWeeks as week (week.weekIso)}
    <section class="operation-week" aria-label={`Week of ${formatMonthDay(week.weekIso)}`}>
      <div class="week-heading" data-row={rowKey(week.weekIso)}>
        <div class="week-title">
          <Icon name="calendar" size={18} />
          <h3>Week of {formatMonthDay(week.weekIso)}</h3>
          <span class="week-count">{week.raids.length} raids</span>
        </div>
        {#if week.waiting}<div class="waiting">
            <small>{week.waiting} not checked in</small>
            <button
              class="text-button fix"
              onclick={() => open(week.weekIso, null, CHECKIN_ACTION.intent)}
              aria-label={`${CHECKIN_ACTION.label}, week of ${formatMonthDay(week.weekIso)}`}
              >{CHECKIN_ACTION.label} <Icon name="arrow" size={14} /></button
            >
          </div>{:else if week.waiting === 0}<small class="ok"
            ><Icon name="check" size={14} /> Everyone checked in</small
          >{/if}
      </div>
      <ul class="raid-queue">
        {#each week.raids as raid (raid.raidId)}
          <li class="raid-row" data-row={rowKey(raid.weekIso, raid.raidId)}>
            <span class="raid-emblem" class:is-published={raid.status === 'published'}
              ><Icon name={raid.status === 'published' ? 'shield' : 'planner'} size={22} /></span
            >
            <div class="what">
              <strong>{raid.raidName}</strong>
              <small>{when(raid.start)}</small>
            </div>
            <span
              class="badge raid-status"
              class:published={raid.status === 'published'}
              class:cancelled={raid.status === 'cancelled'}>{STATUS_LABELS[raid.status]}</span
            >
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
                <span class="ok"><Icon name="check" size={14} /> Ready</span>
              {/if}
              {#if raid.status === 'published'}<button
                  class="text-button fix"
                  onclick={() => open(raid.weekIso, raid.raidId, RESPONSES_ACTION.intent)}
                  aria-label={`${RESPONSES_ACTION.label}: ${raid.raidName}, week of ${formatMonthDay(raid.weekIso)}`}
                  >{RESPONSES_ACTION.label}</button
                >{/if}
            </div>
            <button
              class="open-raid"
              onclick={() => open(raid.weekIso, raid.raidId)}
              aria-label={`Open ${raid.raidName}, week of ${formatMonthDay(raid.weekIso)}`}
              >Open <Icon name="arrow" size={16} /></button
            >
          </li>
        {/each}
      </ul>
    </section>
  {/each}
  {#if !visibleWeeks.length}
    <div class="queue-empty">
      <Icon name={filter === 'attention' ? 'check' : 'calendar'} size={32} />
      <h3>
        {filter === 'attention'
          ? 'All clear'
          : filter === 'published'
            ? 'No published rosters yet'
            : 'No upcoming raids'}
      </h3>
      <p>
        {filter === 'published'
          ? 'Choose a time and publish a roster to share it with your players.'
          : 'There are no raids in this view.'}
      </p>
      {#if filter !== 'all'}<button onclick={() => (filter = 'all')}>Show all raids</button>{/if}
    </div>
  {/if}
</section>

<style>
  .officer-dashboard {
    margin-bottom: 24px;
  }
  .workload {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 32px;
  }
  .workload > button,
  .checkin-metric {
    text-align: left;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    min-width: 0;
  }
  .workload > button {
    border-top: 2px solid var(--line);
  }
  .workload > button.chosen {
    border-color: var(--gold);
    background: #29261f;
  }
  .metric-label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 12px;
  }
  .workload strong {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 34px;
    font-weight: 600;
    margin: 10px 0 4px;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }
  .workload strong > :global(svg) {
    opacity: 0.5;
  }
  .workload .attention strong {
    color: var(--gold);
  }
  .workload .published-metric strong {
    color: var(--blue);
  }
  .checkin-metric strong {
    display: block;
    color: var(--green);
  }
  .checkin-metric strong span {
    color: var(--muted);
    font-size: 16px;
  }
  .metric-track {
    height: 3px;
    background: var(--line);
    margin: 9px 0;
    border-radius: 3px;
    overflow: hidden;
  }
  .metric-track span {
    display: block;
    height: 100%;
    background: var(--green);
  }
  .filter-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    min-height: 40px;
    margin: 4px 0 14px;
    font-size: 12px;
  }
  .filter-summary button {
    margin: 0;
    padding-block: 4px;
  }
  .operation-week {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    margin-bottom: 20px;
    overflow: hidden;
  }
  .week-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 16px 20px;
    flex-wrap: wrap;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .week-title,
  .waiting {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .week-title > :global(svg) {
    color: var(--gold);
  }
  .week-count {
    font-size: 11px;
    color: var(--muted);
  }
  .heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  h3 {
    font-size: 14px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .raid-row {
    display: grid;
    grid-template-columns: 40px minmax(140px, 1.1fr) 100px minmax(180px, 1.4fr) auto;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 20px;
    border-bottom: 1px solid var(--line);
  }
  .raid-row:last-child {
    border-bottom: 0;
  }
  .raid-emblem {
    width: 40px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid #64543b;
    border-radius: 8px 8px 14px 14px;
    background: #dbb5740a;
    color: var(--gold);
  }
  .raid-emblem.is-published {
    color: var(--blue);
    border-color: #456780;
    background: #98bddc0a;
  }
  .raid-status {
    justify-self: start;
  }
  .cancelled {
    color: var(--muted);
    border-color: var(--line);
    background: var(--surface);
  }
  .open-raid {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .what {
    display: grid;
    gap: 4px;
    overflow-wrap: anywhere;
  }
  .what small {
    color: var(--muted);
  }
  .issues {
    min-width: 0;
  }
  .issue-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    padding: 0;
    border: 0;
    gap: 0 0.75rem;
    color: var(--muted);
    font-size: 13px;
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
  .queue-empty {
    text-align: center;
    padding: 48px 20px;
    border: 1px dashed var(--line);
    border-radius: var(--radius);
  }
  .queue-empty > :global(svg) {
    color: var(--gold);
    margin-bottom: 16px;
  }
  @media (max-width: 1200px) {
    .workload {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .raid-row {
      grid-template-columns: 40px minmax(0, 1fr) auto;
    }
    .raid-status {
      grid-column: 3;
      grid-row: 1;
    }
    .issues {
      grid-column: 2;
    }
    .open-raid {
      grid-column: 3;
      align-self: end;
    }
  }
  @media (max-width: 600px) {
    .workload {
      gap: 8px;
      margin-bottom: 24px;
    }
    .workload > button,
    .checkin-metric {
      padding: 14px;
    }
    .metric-label {
      font-size: 11px;
      gap: 6px;
      align-items: start;
    }
    .workload strong {
      font-size: 28px;
    }
    .workload small {
      font-size: 11px;
    }
    .raid-row {
      grid-template-columns: 32px minmax(0, 1fr) auto;
      gap: 10px;
      padding: 16px;
    }
    .raid-emblem {
      width: 32px;
      height: 38px;
    }
    .raid-status {
      grid-column: 2;
      grid-row: 2;
    }
    .issues {
      grid-column: 2 / -1;
      grid-row: 3;
    }
    .open-raid {
      grid-row: 1 / 3;
    }
    .week-heading {
      padding: 14px 16px;
    }
    .fix {
      min-height: 44px;
    }
  }
</style>
