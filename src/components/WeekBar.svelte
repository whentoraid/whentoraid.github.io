<script>
  import { app } from '../lib/app.svelte.js'
  import { display, displayZone, setLocalTime, viewerZone } from '../lib/display.svelte.js'
  import { formatRowLabel, rowLabelsVary } from '../lib/grid.js'
  import { setCurrentWeek } from '../lib/model.js'
  import { addDays, daysBetween, formatMonthDay, formatWeekRange, mondayOf, todayIso } from '../lib/time.js'

  const DAYS_PER_WEEK = 7
  const RELATIVE = { [-DAYS_PER_WEEK]: 'Last week', 0: 'This week', [DAYS_PER_WEEK]: 'Next week' }

  const guild = $derived(app.data.guild)
  const weekIso = $derived(app.data.currentWeek)
  const thisWeek = $derived(mondayOf(todayIso(guild.timezone)))
  const zone = $derived(displayZone(guild))
  const labelsVary = $derived(rowLabelsVary(weekIso, guild, zone))
  const hoursLabel = $derived(
    `${formatRowLabel(weekIso, 0, guild, zone)}–${formatRowLabel(weekIso, guild.slotsPerDay, guild, zone)}`,
  )

  /** "This week · Oct 19–25", so nobody has to work out where a Monday-dated week ends. */
  const weekLabel = $derived.by(() => {
    const relative = RELATIVE[daysBetween(thisWeek, weekIso)]
    return relative ? `${relative} · ${formatWeekRange(weekIso)}` : formatWeekRange(weekIso)
  })

  function goTo(dateIso) {
    app.data = setCurrentWeek(app.data, dateIso)
  }

  function changeWeek(event) {
    const input = event.currentTarget
    goTo(input.value)
    // Picking a mid-week date snaps to Monday; show the snapped date even if the week did not change.
    input.value = app.data.currentWeek
  }
</script>

<div class="weekbar">
  <div class="week-nav" role="group" aria-label="Choose week">
    <button
      aria-label="Previous week, {formatMonthDay(addDays(weekIso, -DAYS_PER_WEEK))}"
      onclick={() => goTo(addDays(weekIso, -DAYS_PER_WEEK))}>‹</button
    >
    <label class="field">
      Week beginning
      <input type="date" value={weekIso} onchange={changeWeek} />
    </label>
    <button
      aria-label="Next week, {formatMonthDay(addDays(weekIso, DAYS_PER_WEEK))}"
      onclick={() => goTo(addDays(weekIso, DAYS_PER_WEEK))}>›</button
    >
    <button disabled={weekIso === thisWeek} onclick={() => goTo(thisWeek)}>This week</button>
    <p class="week-range" aria-live="polite">{weekLabel}</p>
  </div>
  <div class="right">
    {#if viewerZone !== guild.timezone}
      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={display.localTime}
          onchange={(e) => setLocalTime(e.currentTarget.checked)}
        />
        Use my timezone ({viewerZone.replaceAll('_', ' ')})
      </label>
    {/if}
    <small
      >Times in {zone.replaceAll('_', ' ')}{zone === guild.timezone
        ? ''
        : ` · guild time is ${guild.timezone.replaceAll('_', ' ')}`}</small
    >
    <details class="time-details">
      <summary>Time details</summary><small>{hoursLabel} · 30-minute slots · +1 = next day</small>
    </details>
    {#if labelsVary}
      <small class="gold"
        >Clocks change this week: row times are Monday’s. Select a cell for its exact date and time.</small
      >
    {/if}
  </div>
</div>
