<script>
  import PageTitle from '../components/PageTitle.svelte'
  import OfficerDashboard from '../components/OfficerDashboard.svelte'
  import RecordCorrections from '../components/RecordCorrections.svelte'
  import { recordFlagsOnline } from '../lib/record-flags.svelte.js'

  /** Officers: the guild's raid workload, kept off My raids so that page stays about the officer's own raids. */
  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(timer)
  })
</script>

<PageTitle
  eyebrow="GUILD TOOLS"
  title="Officer dashboard"
  subtitle="What each upcoming raid still needs, and anything players have asked you to check."
/>

{#if recordFlagsOnline()}<RecordCorrections />{/if}
<OfficerDashboard {now} />
