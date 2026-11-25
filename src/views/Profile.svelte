<script>
  import CalendarSubscription from '../components/CalendarSubscription.svelte'
  import RaidRecord from '../components/RaidRecord.svelte'
  import ReminderPreferences from '../components/ReminderPreferences.svelte'
  import Characters from './Characters.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import { app } from '../lib/app.svelte.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { memberById } from '../lib/model.js'

  const memberId = $derived(app.data.currentMemberId)
  const member = $derived(memberById(app.data, memberId))
  const weekIso = $derived(app.data.currentWeek)
  const online = $derived(Boolean(remote.guildId) && remote.memberId === memberId)
</script>

<PageTitle
  icon="character"
  eyebrow="YOUR ACCOUNT"
  title="Profile"
  subtitle={`Characters and personal settings · ${displayZone(app.data.guild).replaceAll('_', ' ')}`}
/>

<section class="panel profile-section" aria-label="Your characters">
  <Characters embedded />
</section>

<section class="profile-section" aria-label="Raid history">
  <h2>Raid history</h2>
  <RaidRecord {memberId} thisWeek={weekIso} now={Date.now()} />
</section>

{#if online}
  <section class="profile-section" aria-label="Personal settings">
    <h2>Personal settings</h2>
    <details class="panel">
      <summary>Private calendar link</summary>
      <p class="note">
        Add your published raids to a personal calendar. This private link only includes rosters published
        with you on them.
      </p>
      <CalendarSubscription />
    </details>
    <ReminderPreferences discordLinked={Boolean(member?.discordId)} />
  </section>
{/if}

<style>
  .profile-section {
    margin: 1.5rem 0;
  }
  .profile-section > h2 {
    margin: 0 0 0.75rem;
  }
</style>
