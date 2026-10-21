<script>
  import { displayZone } from '../lib/display.svelte.js'
  import {
    availabilityDays,
    copyLocalDay,
    rangesInWindows,
    rangeFromSelection,
  } from '../lib/availability-ranges.js'
  import { compactSessionLabel, exactSessionLabel } from '../lib/personal-raids.js'
  import { formatMonthDay, wallTime, weekdayIndex } from '../lib/time.js'
  import { DAYS } from '../lib/constants.js'
  import Icon from './Icon.svelte'

  let { weekIso, grid, ranges, onpaint, oneditstart = () => {}, oneditend = () => {} } = $props()
  const zone = $derived(displayZone(grid))
  const days = $derived(
    availabilityDays(weekIso, grid, zone).map((entry, day) => ({
      ...entry,
      day,
      name: DAYS[weekdayIndex(entry.dateIso)],
    })),
  )
  let error = $state('')
  let copyTargets = $state({})
  let copied = $state('')

  function copyDay(day) {
    const target = copyTargets[day] ?? (day === 0 ? 1 : 0)
    const intervals = copyLocalDay(ranges, days[day], days[Number(target)], zone)
    if (!intervals.length) {
      error = 'These times do not fit the selected day. Add times for that day instead.'
      return
    }
    error = ''
    oneditstart()
    for (const interval of intervals) onpaint(interval, true)
    oneditend()
    copied = `${days[day].name} times added to ${days[Number(target)].name}. Existing times were kept.`
  }

  function summaryLabel(interval) {
    return compactSessionLabel(interval, zone)
  }
  function clockLabel(instant, dateIso, boundaries) {
    const offset = (value) =>
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(value)
        .find((part) => part.type === 'timeZoneName').value
    const changesClock = offset(boundaries[0]) !== offset(boundaries.at(-1))
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      ...(changesClock ? { timeZoneName: 'short' } : {}),
    }).format(instant)
    return wallTime(instant, zone).dateIso === dateIso ? time : `${time} (next day)`
  }

  function label(instant) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(instant)
  }

  function add(event, boundaries, windows) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const interval = rangeFromSelection(boundaries, form.get('start'), form.get('end'))
    if (!interval) {
      error = 'Choose an end time after the start time.'
      return
    }
    oneditstart()
    for (const part of rangesInWindows([interval], windows)) onpaint(part, true)
    oneditend()
  }

  function edit(interval, available) {
    error = ''
    oneditstart()
    onpaint(interval, available)
    oneditend()
  }
</script>

{#if error}<p role="alert" class="warning">{error}</p>{/if}
{#if copied}<p role="status" class="copy-status">{copied}</p>{/if}
<div class="day-ranges">
  {#each days as { name, day, dateIso, windows, boundaries } (dateIso)}
    {@const saved = rangesInWindows(ranges, windows)}
    <details class="day-editor" class:has-times={saved.length > 0}>
      <summary
        aria-label={`Edit ${name} availability${days.findIndex((entry) => entry.name === name) !== day ? ` (${formatMonthDay(dateIso)})` : ''}`}
        aria-describedby={`day-summary-${day}`}
        ><span class="day-heading"><strong>{name}</strong><small>{formatMonthDay(dateIso)}</small></span><span
          id={`day-summary-${day}`}
          class="day-summary"
          class:has-times={saved.length > 0}
          >{saved.length ? saved.map(summaryLabel).join(' · ') : 'No times added'}</span
        ><span class="day-edit-label" aria-hidden="true"
          ><Icon name={saved.length ? 'clock' : 'plus'} size={14} />
          {saved.length ? 'Edit' : 'Add times'}</span
        ></summary
      >
      <section aria-label={`${name} availability`} class="day-editor-content">
        {#if saved.length}
          <ul>
            {#each saved as interval (`${interval.start}:${interval.end}`)}
              <li>
                <span>{exactSessionLabel(interval, zone)}</span><button
                  aria-label={`Remove ${name} availability ${label(interval.start)}`}
                  onclick={() => edit(interval, false)}>Remove</button
                >
              </li>
            {/each}
          </ul>
        {:else}<p class="note">No times added</p>{/if}
        <p class="note">{formatMonthDay(dateIso)} · {zone.replaceAll('_', ' ')}</p>
        <form onsubmit={(event) => add(event, boundaries, windows)}>
          <label class="field"
            >{name} from<select name="start"
              >{#each boundaries.slice(0, -1) as instant (instant)}<option
                  value={instant}
                  title={label(instant)}>{clockLabel(instant, dateIso, boundaries)}</option
                >{/each}</select
            ></label
          >
          <label class="field"
            >{name} until<select name="end"
              >{#each boundaries.slice(1) as instant (instant)}<option
                  value={instant}
                  selected={instant === boundaries.at(-1)}
                  title={label(instant)}>{clockLabel(instant, dateIso, boundaries)}</option
                >{/each}</select
            ></label
          >
          <button aria-label={`Add times for ${name}`}>Add times</button>
          {#if saved.length}<button
              type="button"
              onclick={() => edit({ start: boundaries[0], end: boundaries.at(-1) }, false)}
              >Clear {name}</button
            >{/if}
        </form>
        {#if saved.length}
          <div class="copy-day">
            <label class="field"
              >Copy {name} times to<select
                value={copyTargets[day] ?? (day === 0 ? 1 : 0)}
                onchange={(event) => (copyTargets[day] = Number(event.currentTarget.value))}
                >{#each days as targetDay, target (targetDay.dateIso)}{#if target !== day}<option
                      value={target}>{targetDay.name} · {formatMonthDay(targetDay.dateIso)}</option
                    >{/if}{/each}</select
              ></label
            ><button type="button" onclick={() => copyDay(day)}>Copy {name} times</button>
          </div>
        {/if}
      </section>
    </details>
  {/each}
</div>

<style>
  .day-editor {
    border-bottom: 1px solid var(--line);
    border-left: 2px solid transparent;
    padding-inline: 12px;
  }
  .day-editor.has-times {
    border-left-color: var(--green);
    background: #90c5a307;
  }
  .day-editor[open] {
    border-left-color: var(--gold);
    background: #dbb57408;
  }
  summary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .day-heading {
    flex: 0 0 66px;
  }
  .day-heading strong {
    font-size: 14px;
  }
  .day-summary {
    flex: 1;
    color: var(--muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .day-summary.has-times {
    color: var(--green);
  }
  .day-edit-label {
    color: var(--gold);
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }
  .day-editor-content {
    padding: 0 0 20px;
  }
  .copy-day {
    display: flex;
    gap: 10px;
    align-items: end;
    margin-top: 16px;
  }
  .copy-status {
    font-size: 13px;
    color: var(--green);
  }
  form {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    align-items: end;
  }
  label {
    flex: 1 1 13rem;
    min-width: 0;
  }
  select {
    max-width: 100%;
    width: 100%;
  }
  ul {
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  li > span {
    flex: 1 1 16rem;
  }
  @media (max-width: 600px) {
    summary {
      gap: 10px;
      flex-wrap: wrap;
    }
    .day-heading {
      flex-basis: 42px;
    }
    .day-summary {
      font-size: 13px;
    }
    .day-edit-label {
      font-size: 13px;
    }
    form label {
      flex-basis: 100%;
    }
  }
</style>
