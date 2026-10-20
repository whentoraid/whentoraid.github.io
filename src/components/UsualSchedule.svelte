<script>
  import { app } from '../lib/app.svelte.js'
  import {
    DEFAULT_REVIEW_WEEKS,
    templateConfirmedOn,
    templateFor,
    templateNeedsReview,
  } from '../lib/availability-template.js'
  import { changesClosedWeek, checkinsClosed } from '../lib/checkins.js'
  import { own } from '../lib/ids.js'
  import {
    confirmAvailabilityTemplate,
    pauseAvailabilityTemplate,
    removeAvailabilityTemplate,
    resumeAvailabilityTemplate,
    REVIEW_WEEK_OPTIONS,
    saveAvailabilityTemplate,
    setAvailabilityTemplateEnd,
    setAvailabilityTemplateReview,
    useAvailabilityTemplate,
  } from '../lib/model.js'
  import { personalRaids } from '../lib/personal-raids.js'
  import { canManage } from '../lib/remote/sync.svelte.js'
  import { addDays, daysBetween, formatMonthDay, mondayOf, todayIso } from '../lib/time.js'
  import { offerUndo, showToast } from '../lib/toast.svelte.js'
  import { untrack } from 'svelte'
  import Icon from './Icon.svelte'

  /** The member's usual schedule: save or apply it, take a break, give it a last week, and review it. */
  let { memberId, weekIso } = $props()

  /** How far ahead pause and end weeks can be chosen. */
  const WEEKS_AHEAD = 26

  const template = $derived(own(app.data.templates, memberId))
  const usingTemplate = $derived(
    templateFor(template, weekIso) !== null && !own(app.data.weeks[weekIso]?.checkins, memberId),
  )
  const today = $derived(todayIso(app.data.guild.timezone))
  const thisWeek = $derived(mondayOf(today))
  /** Players cannot change a week whose check-ins closed, so changes start the week after. */
  const firstWeek = $derived(
    !canManage() && checkinsClosed(app.data, thisWeek) ? addDays(thisWeek, 7) : thisWeek,
  )
  const weeks = $derived(Array.from({ length: WEEKS_AHEAD }, (_, i) => addDays(firstWeek, 7 * i)))
  const weekLabel = (week) => `week of ${formatMonthDay(week)}`

  /** A pause that is on now or still to come; one that already ended leaves the form available. */
  const pause = $derived(
    template?.pausedFrom && (!template.pausedUntil || template.pausedUntil > thisWeek)
      ? { from: template.pausedFrom, until: template.pausedUntil ?? null }
      : null,
  )
  const reviewDue = $derived(templateNeedsReview(template, today))
  /** Opens by itself when a review is due; after that the member decides. */
  let expanded = $state(untrack(() => reviewDue))

  let pauseFrom = $state('')
  let pauseUntil = $state('')
  const from = $derived(pauseFrom || firstWeek)
  const until = $derived(pauseUntil && pauseUntil > from ? pauseUntil : null)
  /** Published places in the weeks a pause would cover: pausing does not withdraw from them. */
  const rosteredDuring = $derived(
    personalRaids(app.data, memberId).filter(
      (item) => item.assignment && item.weekIso >= from && (!until || item.weekIso < until),
    ),
  )
  const pausePreview = $derived.by(() => {
    if (!until) return `From the ${weekLabel(from)}, every week counts as away until you resume.`
    const count = daysBetween(from, until) / 7
    return `${count} ${count === 1 ? 'week' : 'weeks'} (${formatMonthDay(from)} – ${formatMonthDay(addDays(until, -1))}) count as away.`
  })

  /** Apply a change unless it would alter a week whose check-ins closed; Undo restores the last state. */
  function change(next, message) {
    const previous = app.data
    if (!canManage() && changesClosedWeek(previous, next, memberId)) {
      showToast(
        'This week’s check-ins have closed and your usual schedule fills them in. Change it from next week instead.',
      )
      return
    }
    app.data = next
    offerUndo(message, previous)
  }

  function changeTemplate(action) {
    if (action === 'save')
      return change(
        saveAvailabilityTemplate(app.data, weekIso, memberId),
        'Usual schedule saved for new weeks.',
      )
    if (action === 'remove')
      return change(
        removeAvailabilityTemplate(app.data, memberId),
        'Usual schedule removed. Saved weeks are unchanged.',
      )
    change(useAvailabilityTemplate(app.data, weekIso, memberId), 'Usual schedule applied to this week.')
  }

  function takeBreak(event) {
    event.preventDefault()
    const result = pauseAvailabilityTemplate(app.data, memberId, from, until)
    if (result.error) return showToast(result.error)
    change(result.state, 'Usual schedule paused. Your times are kept for when you resume.')
  }

  function resume() {
    change(
      resumeAvailabilityTemplate(app.data, memberId, firstWeek),
      `Usual schedule resumed from the ${weekLabel(firstWeek)}.`,
    )
  }

  function setEnd(event) {
    const value = event.currentTarget.value || null
    const result = setAvailabilityTemplateEnd(app.data, memberId, value)
    if (result.error) return showToast(result.error)
    change(
      result.state,
      value
        ? `Usual schedule ends after the ${weekLabel(value)}. You’ll be asked for later weeks.`
        : 'Usual schedule has no last week.',
    )
  }

  function confirm() {
    app.data = confirmAvailabilityTemplate(app.data, memberId)
    showToast('Thanks. Your usual schedule is confirmed.')
  }
</script>

<details class="usual-schedule" bind:open={expanded}>
  <summary
    ><span
      ><Icon name="repeat" size={17} /> Usual schedule{pause && pause.from <= thisWeek
        ? ' · paused'
        : ''}</span
    ><small>Repeat your times each week, or take a break.</small></summary
  >
  <div class="buttons">
    <button onclick={() => changeTemplate('save')}>Save as usual schedule</button>
    {#if template}
      <button disabled={templateFor(template, weekIso) === null} onclick={() => changeTemplate('use')}
        >Use usual schedule this week</button
      >
      <button onclick={() => changeTemplate('remove')}>Remove usual schedule</button>
    {/if}
  </div>
  {#if template}
    <p class="note">
      Usual schedule saved in {template.timezone}, from the week of {formatMonthDay(template.fromWeek)}.
      {usingTemplate ? 'This week uses it automatically.' : 'Saved weekly check-ins override it.'}
    </p>

    <section class="schedule-part" aria-label="Review your usual schedule">
      <p class:warning={reviewDue}>
        {reviewDue ? 'Is this still right? ' : ''}Last confirmed {formatMonthDay(
          templateConfirmedOn(template),
        )}.
      </p>
      <div class="buttons">
        <button class:primary={reviewDue} onclick={confirm}>Still right</button>
        <label class="field inline"
          >Ask me again every
          <select
            value={template.reviewWeeks ?? DEFAULT_REVIEW_WEEKS}
            onchange={(e) =>
              (app.data = setAvailabilityTemplateReview(app.data, memberId, Number(e.currentTarget.value)))}
          >
            {#each REVIEW_WEEK_OPTIONS as n (n)}<option value={n}>{n} weeks</option>{/each}
          </select></label
        >
      </div>
    </section>

    <section class="schedule-part" aria-label="Take a break">
      {#if pause}
        <p role="status">
          Paused from the {weekLabel(pause.from)}{pause.until
            ? ` until the ${weekLabel(pause.until)}`
            : ' until you resume'}. Paused weeks count as away; your times are kept.
        </p>
        <button onclick={resume}
          >{pause.from > firstWeek ? 'Cancel this break' : `Resume from the ${weekLabel(firstWeek)}`}</button
        >
      {:else}
        <form class="pause-form" onsubmit={takeBreak}>
          <label class="field"
            >Pause from
            <select bind:value={pauseFrom}>
              {#each weeks as week (week)}<option value={week === firstWeek ? '' : week}
                  >Week of {formatMonthDay(week)}</option
                >{/each}
            </select></label
          >
          <label class="field"
            >Resume
            <select bind:value={pauseUntil}>
              <option value="">When I resume it</option>
              {#each weeks.filter((week) => week > from) as week (week)}<option value={week}
                  >Week of {formatMonthDay(week)}</option
                >{/each}
            </select></label
          >
          <button>Take a break</button>
        </form>
        <p class="note">{pausePreview} Your times stay saved and you won’t be reminded.</p>
        {#if rosteredDuring.length}
          <p class="warning">
            You’re on the roster for {rosteredDuring
              .map((item) => `${item.raid.name} (${formatMonthDay(item.weekIso)})`)
              .join(', ')}. A break doesn’t take you off it: tell your officers from My raids.
          </p>
        {/if}
      {/if}
    </section>

    <section class="schedule-part" aria-label="Last week of your usual schedule">
      <label class="field"
        >Last week it applies
        <select value={template.endWeek ?? ''} onchange={setEnd}>
          <option value="">No last week</option>
          {#if template.endWeek && !weeks.includes(template.endWeek)}<option value={template.endWeek}
              >Week of {formatMonthDay(template.endWeek)}</option
            >{/if}
          {#each weeks.filter((week) => week >= template.fromWeek) as week (week)}<option value={week}
              >Week of {formatMonthDay(week)}</option
            >{/each}
        </select></label
      >
      <p class="note">
        After its last week you’ll be asked for your times again; nothing is marked unavailable.
      </p>
    </section>
  {/if}
</details>

<style>
  summary > span {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  summary small {
    padding-left: 26px;
    margin-top: 5px;
  }
  .schedule-part {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--line);
  }
  .schedule-part p {
    margin: 0 0 0.5rem;
  }
  .pause-form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem 1rem;
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
