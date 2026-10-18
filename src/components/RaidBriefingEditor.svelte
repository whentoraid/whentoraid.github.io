<script>
  import { app } from '../lib/app.svelte.js'
  import { formatFullDateIn } from '../lib/grid.js'
  import { BRIEFING_LIMITS, safeVoiceLink } from '../lib/raid-briefing.js'
  import {
    briefings,
    briefingsOnline,
    loadBriefings,
    saveBriefing,
    saveWeekNote,
  } from '../lib/raid-briefing.svelte.js'
  import { getRaid } from '../lib/raids.js'
  import { canManage } from '../lib/remote/sync.svelte.js'
  import { mondayOf, todayIso } from '../lib/time.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * M15: the selected raid profile's optional raid-day logistics, and a note for one week. They are
   * information only: saving never changes a roster, a response, or who is asked to confirm.
   */
  const WEEKS_SHOWN = 8
  const raid = $derived(getRaid(app.data))
  const guild = $derived(app.data.guild)
  const online = $derived(briefingsOnline())

  let assembly = $state('')
  let location = $state('')
  let voiceUrl = $state('')
  let contact = $state('')
  let notes = $state('')
  let week = $state('')
  let busy = $state(false)

  $effect(() => {
    if (online) loadBriefings()
  })

  // Show what is saved whenever the raid or the loaded briefing changes.
  $effect(() => {
    const saved = briefings.data.raids[raid.id] ?? {}
    assembly = saved.assemblyMinutes ?? ''
    location = saved.location ?? ''
    voiceUrl = saved.voiceUrl ?? ''
    contact = saved.contact ?? ''
    notes = saved.notes ?? ''
  })

  const weeks = $derived(
    Object.keys(app.data.weeks)
      .filter((w) => w >= mondayOf(todayIso(guild.timezone)) && app.data.weeks[w].plans?.[raid.id])
      .sort()
      .slice(0, WEEKS_SHOWN),
  )
  $effect(() => {
    if (!weeks.includes(week)) week = weeks[0] ?? ''
  })
  // Writable: the officer edits it, and choosing another week shows that week's saved note.
  let weekNote = $derived(
    briefings.data.notes.find((n) => n.week === week && n.raidId === raid.id)?.note ?? '',
  )

  const voiceError = $derived(
    voiceUrl.trim() && !safeVoiceLink(voiceUrl)
      ? 'Use a web address that starts with https://, such as a Discord channel link.'
      : '',
  )

  async function run(request, message) {
    busy = true
    try {
      await request()
      showToast(message)
    } catch (e) {
      showToast(e.message)
    } finally {
      busy = false
    }
  }

  function save(event) {
    event.preventDefault()
    if (voiceError) return showToast(voiceError)
    const minutes = assembly === '' || assembly === null ? null : Number(assembly)
    run(
      () => saveBriefing(raid.id, { assemblyMinutes: minutes, location, voiceUrl, contact, notes }),
      `Raid-day details saved for ${raid.name}.`,
    )
  }

  function saveNote(event) {
    event.preventDefault()
    run(
      () => saveWeekNote(week, raid.id, weekNote),
      weekNote.trim() ? 'Note saved for that week.' : 'Note removed.',
    )
  }

  const weekLabel = (w) => {
    const plan = app.data.weeks[w]?.plans[raid.id]
    return plan?.start ? formatFullDateIn(plan.start, guild.timezone) : `Week of ${w}`
  }
</script>

<section class="panel settings-panel" aria-label="Raid-day details">
  <details class="settings-section">
    <summary><h2>Raid-day details</h2></summary>
    <p>
      Optional details for {raid.name}: when to meet up, where, the voice chat, and who to contact. Players
      see them on their next raid, and the Discord roster post includes them. They never change the roster or
      who needs to confirm.
    </p>
    {#if !online}
      <p class="note">Raid-day details are shared once your guild is online.</p>
    {:else}
      {#if briefings.error}
        <p class="warning" role="alert">
          Couldn’t load the saved details: {briefings.error}
          <button type="button" onclick={() => loadBriefings({ fresh: true })}>Try again</button>
        </p>
      {/if}
      <form onsubmit={save}>
        <fieldset class="plain" disabled={!canManage() || busy}>
          <div class="settings-grid">
            <label class="field">
              Meet up (minutes before start)
              <input
                type="number"
                min="0"
                max={BRIEFING_LIMITS.assemblyMinutes}
                step="5"
                placeholder="None"
                bind:value={assembly}
              />
            </label>
            <label class="field">
              Meeting place
              <input
                maxlength={BRIEFING_LIMITS.location}
                placeholder="e.g. Stormwind gates"
                bind:value={location}
              />
            </label>
            <label class="field">
              Voice chat link
              <input
                type="url"
                inputmode="url"
                maxlength="300"
                placeholder="https://discord.com/channels/…"
                aria-invalid={Boolean(voiceError)}
                bind:value={voiceUrl}
              />
              {#if voiceError}<small class="warning">{voiceError}</small>{/if}
            </label>
            <label class="field">
              Contact for problems
              <input
                maxlength={BRIEFING_LIMITS.contact}
                placeholder="e.g. Sam (whisper in game)"
                bind:value={contact}
              />
            </label>
          </div>
          <label class="field">
            Preparation notes
            <textarea rows="3" maxlength={BRIEFING_LIMITS.notes} bind:value={notes}></textarea>
          </label>
          <div class="buttons"><button class="primary">Save raid-day details</button></div>
        </fieldset>
      </form>

      <h3>Note for one week</h3>
      {#if weeks.length}
        <form onsubmit={saveNote}>
          <fieldset class="plain" disabled={!canManage() || busy}>
            <label class="field">
              Raid
              <select bind:value={week}>
                {#each weeks as w (w)}<option value={w}>{weekLabel(w)}</option>{/each}
              </select>
            </label>
            <label class="field">
              Note
              <textarea
                rows="2"
                maxlength={BRIEFING_LIMITS.weekNote}
                placeholder="e.g. We start on the second boss this week."
                bind:value={weekNote}></textarea>
            </label>
            <div class="buttons"><button>Save week note</button></div>
          </fieldset>
        </form>
      {:else}
        <p class="note">Plan an upcoming {raid.name} first to add a note for that week.</p>
      {/if}
    {/if}
  </details>
</section>
