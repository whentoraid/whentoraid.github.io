<script>
  import { app } from '../lib/app.svelte.js'
  import { memberActions } from '../lib/action-inbox.js'
  import { formatDeadline } from '../lib/checkins.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { personalRaids } from '../lib/personal-raids.js'
  import { loadRaidResponses, responsesSaved } from '../lib/raid-responses.svelte.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { timeLeft } from '../lib/standby.js'
  import { loadStandbyWeek, standbyOnline, standbyWeek } from '../lib/standby.svelte.js'

  /**
   * M06: a short list of what the player still has to do. Each item clears itself once it is done,
   * in the app or on Discord, because it is read back from the same records.
   */
  let { memberId, thisWeek, now, onavailability } = $props()

  const upcoming = $derived(personalRaids(app.data, memberId, now))
  const raidKey = (item) => `${item.weekIso}:${item.raidId}`

  let responses = $state({})
  $effect(() => {
    void responsesSaved.count
    const assigned = upcoming.filter((item) => item.assignment)
    let active = true
    Promise.all(
      assigned.map((item) =>
        loadRaidResponses(item.weekIso, item.raidId, item.plan).then(
          (byMember) => [raidKey(item), byMember[memberId]?.status ?? null],
          // Unknown stays out of the list rather than nagging about something already done.
          () => null,
        ),
      ),
    ).then((entries) => {
      if (active) responses = Object.fromEntries(entries.filter(Boolean))
    })
    return () => {
      active = false
    }
  })

  const offersOnline = $derived(standbyOnline() && remote.memberId === memberId)
  const offerWeeks = $derived([...new Set(upcoming.filter((item) => !item.assignment).map((i) => i.weekIso))])
  $effect(() => {
    if (offersOnline) for (const week of offerWeeks) void loadStandbyWeek(week)
  })
  const offers = $derived(offersOnline ? offerWeeks.flatMap((week) => standbyWeek(week)?.offers ?? []) : [])

  const actions = $derived(memberActions(app.data, memberId, { now, thisWeek, responses, offers }))

  const BUTTONS = {
    offer: 'Answer',
    confirm: 'Confirm',
    availability: 'Give availability',
    schedule: 'Review',
  }
  const at = (instant) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: viewerZone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant)
  function when(action) {
    if (action.due === null) return ''
    if (action.kind === 'offer') return timeLeft(action.due, now)
    if (action.kind === 'availability') return `Due ${formatDeadline(action.due, viewerZone)}`
    return `Raid starts ${at(action.due)}`
  }

  function go(action) {
    if (!action.anchor) return onavailability()
    const target = document.getElementById(action.anchor)
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    target?.querySelector('button')?.focus({ preventScroll: true })
  }
</script>

{#if actions.length}
  <section class="panel action-inbox" aria-label="Needs you">
    <span class="eyebrow">NEEDS YOU</span>
    <ul>
      {#each actions as action (action.id)}
        <li>
          <div>
            <strong>{action.title}</strong>
            <small
              >{action.detail}{#if when(action)}<span class="due"> · {when(action)}</span>{/if}</small
            >
          </div>
          <button class:primary={action === actions[0]} onclick={() => go(action)}
            >{BUTTONS[action.kind]}</button
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .action-inbox {
    margin-bottom: 24px;
    border-left: 2px solid var(--gold);
  }
  ul {
    display: grid;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  li:last-child {
    border-bottom: 0;
  }
  li div {
    display: grid;
    gap: 2px;
    flex: 1 1 16rem;
  }
  .due {
    color: var(--gold);
  }
</style>
