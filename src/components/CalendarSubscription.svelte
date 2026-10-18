<script>
  import {
    calendarSubscriptionUrl,
    createCalendarSubscription,
    revokeCalendarSubscription,
  } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * A private calendar link with only this player's published raids. Calendar apps re-check it,
   * so new times and cancellations arrive by themselves. The link is shown once: the server keeps
   * only a fingerprint of it, so making a new one turns the old one off.
   */
  let link = $state('')
  let busy = $state(false)

  async function run(action) {
    busy = true
    try {
      await action()
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
    }
  }

  const create = () =>
    run(async () => {
      const token = await createCalendarSubscription(supabase, remote.guildId)
      link = calendarSubscriptionUrl(import.meta.env.VITE_SUPABASE_URL, token)
    })

  const revoke = () =>
    run(async () => {
      await revokeCalendarSubscription(supabase, remote.guildId)
      link = ''
      showToast('Calendar link turned off. Calendars using it stop updating.')
    })

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      showToast('Calendar link copied. Paste it into your calendar app to subscribe.')
    } catch {
      showToast('Select the link and copy it.')
    }
  }
</script>

<section class="panel" aria-label="Calendar link">
  <h2>Add your raids to your calendar</h2>
  <p>
    A private link your calendar app subscribes to. It lists only your published raids and follows officers’
    changes: new times, swaps and cancellations. A downloaded .ics file is different: it adds one raid as it
    is now and never updates.
  </p>
  {#if link}
    <label class="field">
      Your calendar link
      <input readonly value={link} onfocus={(e) => e.currentTarget.select()} />
    </label>
    <p class="note">Keep it to yourself: anyone with the link can see your raid times.</p>
    <div class="buttons">
      <button class="primary" onclick={copy}>Copy link</button>
      <button disabled={busy} onclick={revoke}>Turn off link</button>
    </div>
  {:else}
    <p class="note">
      Creating a link turns off any link you made before, and calendars still using the old one stop updating.
      Subscribe again with the new link.
    </p>
    <div class="buttons">
      <button disabled={busy} onclick={create}>Create calendar link</button>
      <button disabled={busy} onclick={revoke}>Turn off my old link</button>
    </div>
  {/if}
  <details class="calendar-help">
    <summary>How to subscribe in your calendar app</summary>
    <dl>
      <dt>Google Calendar</dt>
      <dd>
        On a computer, open Google Calendar. Next to Other calendars, select +, then From URL. Paste the link
        and select Add calendar. The Google Calendar phone app can’t subscribe, but shows the calendar once it
        is added.
      </dd>
      <dt>Apple Calendar (iPhone or iPad)</dt>
      <dd>
        Open Calendar, tap Calendars, then Add Calendar → Add Subscription Calendar. Paste the link and tap
        Subscribe (Find on iOS 26).
      </dd>
      <dt>Apple Calendar (Mac)</dt>
      <dd>Choose File → New Calendar Subscription, paste the link and click Subscribe.</dd>
      <dt>Outlook</dt>
      <dd>
        In Outlook on the web or Outlook.com, select Add calendar → Subscribe from web, paste the link and
        import it. Don’t use Upload from file: that copy never updates.
      </dd>
    </dl>
    <p class="note">
      Calendar apps check the link on their own schedule, so changes can take a few hours to appear. Copying
      the link doesn’t connect anything by itself: your raids appear once your calendar app has subscribed.
    </p>
  </details>
</section>

<style>
  .calendar-help {
    margin-top: 1rem;
  }
  .calendar-help dt {
    margin-top: 0.75rem;
    font-weight: 600;
  }
  .calendar-help dd {
    margin: 0.25rem 0 0;
  }
</style>
