<script>
  import Icon from './Icon.svelte'
  import RaidResponse from './RaidResponse.svelte'
  import StandbyOffer from './StandbyOffer.svelte'
  import { DAYS } from '../lib/constants.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { app } from '../lib/app.svelte.js'
  import { getCheckin } from '../lib/model.js'
  import { raidAnswer } from '../lib/raid-answers.js'
  import { listRaidSignups } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { addDays, daysBetween, mondayOf, todayIso, wallTime, weekdayIndex } from '../lib/time.js'
  import { tick } from 'svelte'

  let {
    items,
    assignments = [],
    personalItems = [],
    memberId,
    now,
    standbyEnabled = false,
    onanswer,
    onopen,
  } = $props()

  let mode = $state('list')
  let loaded = $state({ scope: null, rows: {}, error: '' })
  let version = 0

  const zone = $derived(displayZone(app.data.guild))
  const weeks = $derived([...new Set(items.map((item) => item.weekIso))])
  const online = $derived(Boolean(remote.guildId && remote.memberId === memberId && supabase))
  const scope = $derived(JSON.stringify([remote.guildId, memberId, weeks]))
  const firstDate = $derived(items.length ? wallTime(items[0].start, zone).dateIso : todayIso(zone, now))
  const lastDate = $derived(items.length ? wallTime(items.at(-1).start, zone).dateIso : firstDate)
  const firstDay = $derived(mondayOf(firstDate))
  const calendarWeeks = $derived(Math.max(1, Math.ceil((daysBetween(firstDay, lastDate) + 1) / 7)))
  const days = $derived.by(() =>
    Array.from({ length: calendarWeeks * 7 }, (_, index) => addDays(firstDay, index)),
  )
  const padding = $derived(Array.from({ length: weekdayIndex(firstDay) }, (_, index) => index))
  const today = $derived(todayIso(zone, now))

  $effect(() => {
    const key = scope
    const weekList = weeks
    if (!online || !weekList.length) {
      loaded = { scope: key, rows: {}, error: '' }
      return
    }
    const read = ++version
    let active = true
    Promise.all(
      weekList.map(async (weekIso) => [weekIso, await listRaidSignups(supabase, remote.guildId, weekIso)]),
    )
      .then((results) => {
        if (!active || read !== version) return
        loaded = {
          scope: key,
          rows: Object.fromEntries(
            results.flatMap(([weekIso, rows]) =>
              (rows ?? [])
                .filter((row) => row.member_id === memberId)
                .map((row) => [`${weekIso}:${row.raid_id}`, row]),
            ),
          ),
          error: '',
        }
      })
      .catch((error) => {
        if (active && read === version) loaded = { scope: key, rows: {}, error: error.message }
      })
    return () => {
      active = false
    }
  })

  function assignmentFor(item) {
    return assignments.find((entry) => entry.weekIso === item.weekIso && entry.raidId === item.raidId)
  }

  function personalItemFor(item) {
    return personalItems.find((entry) => entry.weekIso === item.weekIso && entry.raidId === item.raidId)
  }

  async function showRaidActions(item) {
    mode = 'list'
    await tick()
    const row = document.getElementById(`agenda-${item.weekIso}-${item.raidId}`)
    row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    row?.focus({ preventScroll: true })
  }

  function answerFor(item) {
    if (online) {
      if (loaded.scope !== scope) return 'Loading answer'
      if (loaded.error) return 'Answer unavailable'
      const row = loaded.rows[`${item.weekIso}:${item.raidId}`]
      return (
        {
          signed: "I'm in",
          late: 'Arriving late',
          tentative: 'Maybe',
          absent: "Can't make it",
        }[row?.status] ?? null
      )
    }

    const checkin = getCheckin(app.data, item.weekIso, memberId)
    const preference = checkin.raids?.[item.raidId]
    if (preference?.signupStatus) {
      return (
        {
          signed: "I'm in",
          late: 'Arriving late',
          tentative: 'Maybe',
          absent: "Can't make it",
        }[preference.signupStatus] ?? null
      )
    }
    if (preference?.participating === false) return "Can't make it"
    return null
  }

  function statusFor(item) {
    if (assignmentFor(item)) return 'Your spot'
    const answer = answerFor(item)
    if (answer) return answer
    if (online && (loaded.scope !== scope || loaded.error)) return answer ?? 'Answer not loaded'

    const checkin = getCheckin(app.data, item.weekIso, memberId)
    const availability = raidAnswer(app.data, item.weekIso, memberId, item)
    if (availability === 'out') return "Can't make it"
    if (availability === 'in') return 'Available'
    if (availability === 'tentative') return 'Tentative availability'
    if (checkin.paused) return 'Usual schedule paused'
    return item.kind === 'published' ? 'Roster published' : 'Scheduled'
  }

  function displayDate(instant, options) {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).format(instant)
  }

  function itemsOn(dateIso) {
    return items.filter((item) => wallTime(item.start, zone).dateIso === dateIso)
  }

  const firstLabel = $derived(
    displayDate(Date.parse(`${firstDay}T12:00:00Z`), { month: 'long', day: 'numeric' }),
  )
  const lastLabel = $derived(
    displayDate(Date.parse(`${addDays(firstDay, calendarWeeks * 7 - 1)}T12:00:00Z`), {
      month: 'long',
      day: 'numeric',
    }),
  )
</script>

<section class="panel raid-agenda" aria-label="Upcoming raids">
  <div class="agenda-heading">
    <div>
      <span class="eyebrow gold">RAID SCHEDULE</span>
      <h2>Upcoming raids</h2>
      <p class="note">{firstLabel} – {lastLabel} · Times in {zone.replaceAll('_', ' ')}</p>
    </div>
    <div class="view-toggle" role="group" aria-label="Raid view">
      <button class:active={mode === 'list'} aria-pressed={mode === 'list'} onclick={() => (mode = 'list')}>
        <Icon name="list" size={16} /> List
      </button>
      <button
        class:active={mode === 'calendar'}
        aria-pressed={mode === 'calendar'}
        onclick={() => (mode = 'calendar')}
      >
        <Icon name="calendar" size={16} /> Calendar
      </button>
    </div>
  </div>

  {#if online && loaded.scope !== scope}
    <p role="status">Loading your raid answers…</p>
  {:else if online && loaded.error}
    <p role="alert">Your saved answers could not be loaded: {loaded.error}</p>
  {/if}

  {#if mode === 'list'}
    {#if items.length}
      <ol class="agenda-list">
        {#each items as item (`${item.weekIso}:${item.raidId}`)}
          {@const assignment = assignmentFor(item)}
          <li id={`agenda-${item.weekIso}-${item.raidId}`} tabindex="-1">
            <div class="date-label">
              <strong>{displayDate(item.start, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
              <small
                >{displayDate(item.start, {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZoneName: 'short',
                })}</small
              >
            </div>
            <div class="raid-label">
              <h3>{item.raid.name}</h3>
              <span class="badge" class:published={item.kind === 'published'}>
                {statusFor(item)}
              </span>
              {#if assignment}
                <p>{assignment.character?.name ?? 'Assigned character'} · {assignment.assignment.role}</p>
              {/if}
            </div>
            {#if assignment}
              <button onclick={() => onopen(item)}>View your spot</button>
            {:else}
              <button onclick={() => onanswer(item)}
                >{answerFor(item) ? 'Change answer' : 'Answer raid'}</button
              >
            {/if}
            {#if assignment}
              <RaidResponse item={assignment} {memberId} />
            {:else if item.kind === 'published' && standbyEnabled && personalItemFor(item)}
              <StandbyOffer item={personalItemFor(item)} {memberId} {now} />
            {/if}
          </li>
        {/each}
      </ol>
    {:else}
      <p class="note">No announced raids in this time range.</p>
    {/if}
  {:else}
    <div class="calendar-grid" aria-label="Raid calendar dates">
      {#each DAYS as day (day)}<div class="weekday" aria-hidden="true">{day.slice(0, 3)}</div>{/each}
      {#each padding as index (`pad-${index}`)}<div class="calendar-pad" aria-hidden="true"></div>{/each}
      {#each days as date (date)}
        {@const dayItems = itemsOn(date)}
        <div class="calendar-day" class:today={date === today} class:empty={!dayItems.length}>
          <strong class="day-number">
            <span class="weekday-inline">{DAYS[weekdayIndex(date)].slice(0, 3)} </span>{Number(
              date.slice(-2),
            )}
          </strong>
          {#each dayItems as item (`${item.weekIso}:${item.raidId}`)}
            <button
              class="calendar-entry"
              class:published={item.kind === 'published'}
              onclick={() => showRaidActions(item)}
            >
              <strong>{item.raid.name}</strong>
              <small
                >{displayDate(item.start, { hour: 'numeric', minute: '2-digit' })} · {statusFor(item)}</small
              >
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .raid-agenda {
    margin: 1.25rem 0;
    padding: 20px;
  }
  .agenda-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  .agenda-heading h2 {
    margin: 5px 0;
  }
  .agenda-heading p {
    margin: 0;
  }
  .view-toggle {
    display: flex;
    gap: 6px;
  }
  .view-toggle button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .view-toggle button.active {
    border-color: var(--gold);
    color: var(--gold);
  }
  .agenda-list {
    display: grid;
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }
  .agenda-list li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 0;
    border-top: 1px solid var(--line);
  }
  .date-label {
    flex: 0 0 142px;
    display: grid;
    gap: 4px;
  }
  .date-label small,
  .raid-label p {
    color: var(--muted);
  }
  .raid-label {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    flex: 1 1 auto;
  }
  .raid-label h3,
  .raid-label p {
    margin: 0;
  }
  .raid-label h3 {
    min-width: 10rem;
  }
  .calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 6px;
    margin-top: 16px;
  }
  .weekday {
    padding: 6px;
    color: var(--muted);
    text-align: center;
    font-size: 12px;
  }
  .calendar-pad {
    min-height: 52px;
  }
  .calendar-day {
    min-height: 92px;
    min-width: 0;
    display: grid;
    align-content: start;
    gap: 5px;
    padding: 7px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #12171966;
  }
  .calendar-day.today {
    border-color: var(--gold);
  }
  .calendar-day.empty {
    opacity: 0.6;
  }
  .day-number {
    color: var(--muted);
    font-size: 12px;
  }
  .today .day-number {
    color: var(--gold);
  }
  .weekday-inline {
    display: none;
  }
  .calendar-entry {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 5px;
    text-align: left;
    font-size: 11px;
    border-left: 3px solid var(--muted);
  }
  .calendar-entry.published {
    border-left-color: var(--blue);
  }
  .calendar-entry strong,
  .calendar-entry small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 700px) {
    .agenda-list li {
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .date-label {
      flex-basis: 100%;
    }
    .agenda-list li > button {
      width: 100%;
    }
    .calendar-grid {
      grid-template-columns: 1fr;
    }
    .weekday,
    .calendar-pad,
    .calendar-day.empty {
      display: none;
    }
    .calendar-day {
      min-height: 0;
    }
    .weekday-inline {
      display: inline;
    }
  }
</style>
