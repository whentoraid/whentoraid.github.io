<script>
  import { viewerZone } from '../lib/display.svelte.js'
  import { getMyReminderPrefs, setMyReminderPrefs } from '../lib/raid-services.js'
  import { minutesToTime, reminderPrefsSummary, timeToMinutes } from '../lib/reminder-prefs.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * M06: a player chooses whether their guild's Discord reminders ping them, and when they stay
   * quiet. The reminders themselves are still posted in the shared channel either way.
   */
  let { discordLinked } = $props()

  let saved = $state(null)
  let ping = $state(true)
  let quiet = $state(false)
  let quietStart = $state('22:00')
  let quietEnd = $state('08:00')
  let error = $state('')
  let busy = $state(false)
  let retry = $state(0)

  $effect(() => {
    const guildId = remote.guildId
    void retry
    let active = true
    error = ''
    getMyReminderPrefs(supabase, guildId)
      .then((prefs) => {
        if (!active) return
        saved = prefs
        ping = prefs.ping
        quiet = prefs.quiet_start !== null
        if (quiet) {
          quietStart = minutesToTime(prefs.quiet_start)
          quietEnd = minutesToTime(prefs.quiet_end)
        }
      })
      .catch((e) => {
        if (active) error = e.message
      })
    return () => {
      active = false
    }
  })

  async function save(event) {
    event.preventDefault()
    const start = quiet ? timeToMinutes(quietStart) : null
    const end = quiet ? timeToMinutes(quietEnd) : null
    if (quiet && (start === null || end === null)) return showToast('Choose when quiet hours start and end.')
    if (quiet && start === end)
      return showToast('Quiet hours need to end at a different time than they start.')
    busy = true
    const guildId = remote.guildId
    try {
      await setMyReminderPrefs(supabase, guildId, {
        ping,
        quietStart: start,
        quietEnd: end,
        timezone: viewerZone,
      })
      if (guildId !== remote.guildId) return
      saved = { ping, quiet_start: start, quiet_end: end, timezone: viewerZone }
      showToast('Reminder preferences saved.')
    } catch (e) {
      showToast(e.message)
    } finally {
      busy = false
    }
  }
</script>

<details class="panel reminder-preferences">
  <summary>
    Discord reminders{#if saved}<span class="summary-state"> · {reminderPrefsSummary(saved)}</span>{/if}
  </summary>
  <p>
    When officers turn on reminders, they are posted in your guild’s Discord channel and name everyone who
    still needs to act. These choices only decide whether a reminder pings you; the post stays in the channel
    for everyone.
  </p>
  {#if !discordLinked}
    <p class="note">Your Discord account isn’t linked to this guild, so reminders name you without a ping.</p>
  {/if}
  {#if error}
    <p class="warning" role="alert">Your reminder preferences could not be loaded: {error}</p>
    <button onclick={() => (retry += 1)}>Retry</button>
  {:else if !saved}
    <p class="note" role="status">Loading your reminder preferences…</p>
  {:else}
    <form onsubmit={save}>
      <fieldset class="plain" disabled={busy}>
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={ping} />
          Ping me when a reminder names me
        </label>
        {#if ping}
          <label class="checkbox-row">
            <input type="checkbox" bind:checked={quiet} />
            Don’t ping me during quiet hours
          </label>
          {#if quiet}
            <div class="quiet-hours">
              <label class="field">From <input type="time" bind:value={quietStart} required /></label>
              <label class="field">Until <input type="time" bind:value={quietEnd} required /></label>
            </div>
            <p class="note">
              In your timezone, {viewerZone.replaceAll('_', ' ')}. Reminders then name you without a ping.
            </p>
          {/if}
        {/if}
        <p class="note">Roster announcements are not affected.</p>
        <div class="buttons"><button class="primary">Save reminder preferences</button></div>
      </fieldset>
    </form>
  {/if}
</details>

<style>
  .reminder-preferences summary {
    cursor: pointer;
    font-weight: 600;
  }
  .summary-state {
    color: var(--muted);
    font-weight: 400;
  }
  .quiet-hours {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
</style>
