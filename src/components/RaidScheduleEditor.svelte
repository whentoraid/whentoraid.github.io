<script>
  import { app } from '../lib/app.svelte.js'
  import { DAYS } from '../lib/constants.js'
  import { minutesToTimeInput, timeInputToMinutes } from '../lib/guild.js'
  import { formatFullDateIn } from '../lib/grid.js'
  import { getRaid } from '../lib/raids.js'
  import {
    changeSeriesOccurrence,
    generateSeriesDrafts,
    previewSeriesChange,
    saveRaidSeries,
    seriesOccurrences,
  } from '../lib/raid-series.js'
  import { canManage } from '../lib/remote/sync.svelte.js'
  import { addDays, formatClock, mondayOf, todayIso } from '../lib/time.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * The selected raid profile's weekly schedule. Saving and creating drafts never publishes a roster
   * or sends a message; officers still choose the roster and publish each week.
   */
  const UPCOMING_SHOWN = 8
  const raid = $derived(getRaid(app.data))
  const guild = $derived(app.data.guild)
  const today = $derived(todayIso(guild.timezone))

  let day = $state(0)
  let time = $state('19:00')
  let startDate = $state('')
  let endDate = $state('')
  /** The occurrence whose time is being changed, by week. */
  let editing = $state(null)
  let editDay = $state(0)
  let editTime = $state('19:00')
  let editScope = $state('this')

  $effect(() => {
    const series = raid.series
    day = series?.day ?? 0
    time = minutesToTimeInput((series?.minutes ?? guild.dayStartHour * 60) % 1440)
    startDate = series?.startDate ?? today
    endDate = series?.endDate ?? addDays(today, 12 * 7)
    editing = null
  })

  /** Times before the guild's planning day starts belong to the night before (an overnight raid). */
  function toSeriesMinutes(value) {
    const minutes = timeInputToMinutes(value)
    return minutes < guild.dayStartHour * 60 ? minutes + 1440 : minutes
  }

  const clockLabel = (minutes) =>
    `${formatClock(minutes % 1440)}${minutes >= 1440 ? ' (after midnight)' : ''}`

  const upcoming = $derived(
    raid.series
      ? seriesOccurrences(raid.series)
          .filter((o) => o.weekIso >= mondayOf(today))
          .slice(0, UPCOMING_SHOWN)
      : [],
  )

  function apply(result, message) {
    if (result.error) return showToast(result.error)
    app.data = result.state
    showToast(message)
  }

  function save(event) {
    event.preventDefault()
    if (!canManage()) return showToast('Only officers can change the raid schedule.')
    const series = {
      ...(raid.series ?? {}),
      startDate,
      endDate,
      day: Number(day),
      minutes: toSeriesMinutes(time),
      timezone: guild.timezone,
    }
    apply(saveRaidSeries(app.data, raid.id, series), `Weekly schedule saved for ${raid.name}.`)
  }

  function remove() {
    apply(saveRaidSeries(app.data, raid.id, null), 'Weekly schedule removed. Existing plans are kept.')
  }

  function createDrafts() {
    const result = generateSeriesDrafts(app.data, raid.id)
    if (result.error) return showToast(result.error)
    app.data = result.state
    showToast(
      result.created
        ? `${result.created} draft ${result.created === 1 ? 'raid' : 'raids'} created. Nothing was published or sent.`
        : 'Every upcoming date already has a plan.',
    )
  }

  function setCancelled(occurrence, cancelled) {
    apply(
      changeSeriesOccurrence(app.data, raid.id, occurrence.weekIso, { cancelled }, 'this'),
      cancelled ? 'This week is cancelled in the schedule.' : 'This week is back on the schedule.',
    )
  }

  function startEdit(occurrence) {
    editing = occurrence.weekIso
    editDay = Number(raid.series.day)
    editTime = minutesToTimeInput(raid.series.minutes % 1440)
    editScope = 'this'
  }

  /** M14: what saving the change will do, week by week, before it is saved. */
  const preview = $derived(
    editing
      ? previewSeriesChange(
          app.data,
          raid.id,
          editing,
          { day: Number(editDay), minutes: toSeriesMinutes(editTime) },
          editScope,
        )
      : null,
  )
  const PREVIEW_LABELS = {
    draft: 'Draft moves',
    scheduled: 'Schedule date moves',
    published: 'Published roster kept as it is: review it yourself',
    past: 'Already started: left alone',
    invalid: 'This time does not exist that day because of the clock change',
  }
  const when = (start) => (start === null ? '—' : formatFullDateIn(start, guild.timezone))
  /** Published rosters the last change left alone, for officers to update and republish themselves. */
  let toReview = $state([])

  function saveEdit(event) {
    event.preventDefault()
    const result = changeSeriesOccurrence(
      app.data,
      raid.id,
      editing,
      { day: Number(editDay), minutes: toSeriesMinutes(editTime) },
      editScope,
    )
    if (result.error) return showToast(result.error)
    app.data = result.state
    editing = null
    toReview = result.skippedWeeks ?? []
    showToast(
      result.skipped
        ? `Schedule changed. ${result.skipped} published ${result.skipped === 1 ? 'roster was' : 'rosters were'} left as published; review them below.`
        : 'Schedule changed.',
    )
  }

  function openPublished(weekIso) {
    app.data = { ...app.data, currentWeek: weekIso, currentRaidId: raid.id }
    app.plannerIntent = { section: 'roster', focus: 'changes' }
    app.view = 'planner'
  }
</script>

<section class="panel settings-panel" aria-label="Weekly schedule">
  <details class="settings-section">
    <summary><h2>Weekly schedule</h2></summary>
    <p>
      Repeat {raid.name} once a week at the same guild time ({guild.timezone}). Use another raid profile for a
      second weekly night.
    </p>
    <form onsubmit={save}>
      <fieldset class="plain" disabled={!canManage()}>
        <div class="settings-grid">
          <label class="field">
            Day
            <select bind:value={day}>
              {#each DAYS as dayName, index (dayName)}<option value={index}>{dayName}</option>{/each}
            </select>
          </label>
          <label class="field">Start time<input type="time" step="1800" required bind:value={time} /></label>
          <label class="field">First date<input type="date" required bind:value={startDate} /></label>
          <label class="field">Last date<input type="date" required bind:value={endDate} /></label>
        </div>
        <div class="buttons">
          <button class="primary">Save schedule</button>
          {#if raid.series}
            <button type="button" onclick={createDrafts}>Create drafts for upcoming dates</button>
            <button type="button" onclick={remove}>Remove schedule</button>
          {/if}
        </div>
      </fieldset>
    </form>

    {#if upcoming.length}
      <h3>Upcoming dates</h3>
      <ul class="occurrences">
        {#each upcoming as occurrence (occurrence.weekIso)}
          {@const plan = app.data.weeks[occurrence.weekIso]?.plans[raid.id]}
          <li>
            <span>
              {#if occurrence.start === null}
                <strong>Week of {occurrence.weekIso}</strong>
                <small class="warning">{occurrence.error}</small>
              {:else}
                <strong>{formatFullDateIn(occurrence.start, guild.timezone)}</strong>
                <small>
                  {occurrence.cancelled
                    ? 'Cancelled'
                    : plan?.published
                      ? 'Published roster'
                      : plan
                        ? 'Draft'
                        : 'Scheduled · no draft yet'}
                </small>
              {/if}
            </span>
            {#if canManage()}
              <span class="buttons">
                <button onclick={() => setCancelled(occurrence, !occurrence.cancelled)}
                  >{occurrence.cancelled ? 'Restore' : 'Cancel this week'}</button
                >
                <button onclick={() => startEdit(occurrence)}>Change time</button>
              </span>
            {/if}
            {#if editing === occurrence.weekIso}
              <form class="edit" onsubmit={saveEdit}>
                <label class="field">
                  Day
                  <select bind:value={editDay}>
                    {#each DAYS as dayName, index (dayName)}<option value={index}>{dayName}</option>{/each}
                  </select>
                </label>
                <label class="field"
                  >Start time<input type="time" step="1800" required bind:value={editTime} /></label
                >
                <fieldset class="plain">
                  <legend>Apply to</legend>
                  <label class="checkbox-row"
                    ><input type="radio" value="this" bind:group={editScope} />Only this week</label
                  >
                  <label class="checkbox-row"
                    ><input type="radio" value="following" bind:group={editScope} />This and following weeks</label
                  >
                </fieldset>
                <div class="impact" aria-live="polite">
                  <h4>Before you save</h4>
                  {#if preview?.error}
                    <p class="warning">{preview.error}</p>
                  {:else if preview}
                    <ul>
                      {#each preview.rows as row (row.weekIso)}
                        <li class:quiet={!row.changed}>
                          <span
                            >{when(row.before)}{#if row.changed && row.after !== null}
                              → <strong>{when(row.after)}</strong>{/if}</span
                          >
                          <small
                            >{row.changed || row.kind !== 'draft'
                              ? PREVIEW_LABELS[row.kind]
                              : 'No change'}{#if row.clockChange}
                              · after a clock change: same guild time, a different hour for players whose
                              clocks don’t change{/if}</small
                          >
                        </li>
                      {/each}
                    </ul>
                    <p class="note">
                      Nothing is published or sent. Moved drafts lose any attendance recorded on them.
                    </p>
                  {/if}
                </div>
                <div class="buttons">
                  <button class="primary" disabled={Boolean(preview?.error)}>Save change</button>
                  <button type="button" onclick={() => (editing = null)}>Cancel</button>
                </div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
      {#if toReview.length}
        <div class="to-review" role="status">
          <p>
            These published rosters kept their old time. Update and republish them, or leave them as they are:
          </p>
          <div class="buttons">
            {#each toReview as weekIso (weekIso)}
              {@const plan = app.data.weeks[weekIso]?.plans[raid.id]}
              <button onclick={() => openPublished(weekIso)}
                >Review {plan ? formatFullDateIn(plan.start, guild.timezone) : `week of ${weekIso}`}</button
              >
            {/each}
          </div>
        </div>
      {/if}
      <p class="note">
        Usually {DAYS[raid.series.day]} at {clockLabel(raid.series.minutes)}. Changes never move a published
        roster or a raid that already started.
      </p>
    {/if}
  </details>
</section>

<style>
  .occurrences {
    list-style: none;
    padding: 0;
  }
  .occurrences li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line, #ffffff14);
  }
  .occurrences small {
    display: block;
    opacity: 0.8;
  }
  .impact {
    flex-basis: 100%;
  }
  .impact h4 {
    margin: 0.5rem 0 0.25rem;
  }
  .impact ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .impact li {
    padding: 4px 0;
  }
  .impact li.quiet {
    opacity: 0.7;
  }
  .to-review {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border-left: 2px solid var(--gold);
  }
  .edit {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: end;
  }
</style>
