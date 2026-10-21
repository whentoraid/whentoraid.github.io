<script>
  import { untrack } from 'svelte'
  import Modal from './Modal.svelte'
  import AvailabilityRanges from './AvailabilityRanges.svelte'
  import { app } from '../lib/app.svelte.js'
  import { templateRanges } from '../lib/availability-template.js'
  import { checkinsClosed, changesClosedWeek } from '../lib/checkins.js'
  import { addInterval, removeInterval } from '../lib/intervals.js'
  import { getCheckin, restoreCheckin, saveAvailabilityTemplate } from '../lib/model.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { addDays, formatWeekRange, mondayOf, todayIso } from '../lib/time.js'
  import { offerUndo } from '../lib/toast.svelte.js'

  let { open, onclose, memberId } = $props()
  let week = $state('')
  let ranges = $state([])
  let error = $state('')
  let draftScope = ''
  // Capture a draft once per opening; live server changes must not overwrite typing.
  $effect(() => {
    if (!open) return
    untrack(() => {
      const thisWeek = mondayOf(todayIso(app.data.guild.timezone))
      week = !canManage() && checkinsClosed(app.data, thisWeek) ? addDays(thisWeek, 7) : thisWeek
      ranges =
        templateRanges(app.data.templates?.[memberId], week) ?? getCheckin(app.data, week, memberId).ranges
      error = ''
      draftScope = JSON.stringify([remote.guildId, memberId])
    })
  })
  function paint(interval, available) {
    ranges = available ? addInterval(ranges, interval) : removeInterval(ranges, interval)
  }
  function save() {
    if (draftScope !== JSON.stringify([remote.guildId, memberId])) {
      error = 'The guild or player changed. Close and reopen your schedule.'
      return
    }
    const before = app.data
    const scratch = restoreCheckin(before, week, memberId, { ...getCheckin(before, week, memberId), ranges })
    const template = saveAvailabilityTemplate(scratch, week, memberId).templates[memberId]
    const next = { ...before, templates: { ...before.templates, [memberId]: template } }
    if (!canManage() && changesClosedWeek(before, next, memberId)) {
      error = 'The deadline passed while you were editing. Close and reopen to start from next week.'
      return
    }
    app.data = next
    offerUndo('Usual schedule saved. Weeks you already answered keep their own times.', before)
    onclose()
  }
</script>

<Modal {open} {onclose} label="Change my usual schedule">
  <h2>Change my usual schedule</h2>
  <p>Repeats from {week ? formatWeekRange(week) : ''}. Weeks you already answered keep their own times.</p>
  {#if open && week}<AvailabilityRanges weekIso={week} grid={app.data.guild} {ranges} onpaint={paint} />{/if}
  {#if error}<p role="alert" class="warning">{error}</p>{/if}
  <div class="buttons spaced-top">
    <button class="primary" onclick={save}>Save usual schedule</button>
    <button onclick={onclose}>Cancel</button>
  </div>
</Modal>
