<script>
  import { app } from '../lib/app.svelte.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { characterById, charactersOf } from '../lib/model.js'
  import { offerStatus, standbyUntilOptions, timeLeft } from '../lib/standby.js'
  import { answerOffer, loadStandbyWeek, setStandby, standbyWeek } from '../lib/standby.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * A player with no place in a published raid: go on standby, and answer when officers offer a place.
   * `item` is one of `personalRaids()` without an assignment. Online guilds only.
   */
  let { item, memberId, now } = $props()

  $effect(() => {
    void loadStandbyWeek(item.weekIso)
  })
  const week = $derived(standbyWeek(item.weekIso))
  const mine = $derived(
    week?.standby.find((row) => row.raid_id === item.raidId && row.member_id === memberId) ?? null,
  )
  const offers = $derived(
    (week?.offers ?? []).filter((offer) => offer.raid_id === item.raidId && offer.member_id === memberId),
  )
  const open = $derived(offers.find((offer) => offerStatus(offer, now) === 'open') ?? null)
  const accepted = $derived(offers.find((offer) => offer.status === 'accepted') ?? null)
  /** The last offer that closed without the player's answer, to say what happened to it. */
  const closed = $derived(
    offers.findLast((offer) => ['filled', 'withdrawn', 'expired'].includes(offerStatus(offer, now))) ?? null,
  )
  const characters = $derived(charactersOf(app.data, memberId))
  const untilOptions = $derived(standbyUntilOptions(item.session.start, now))
  let characterId = $state('')
  let until = $state('')
  let busy = $state(false)

  const at = (instant) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: displayZone(app.data.guild),
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant)
  const placeLabel = (offer) =>
    `${characterById(app.data, offer.character_id)?.name ?? 'Your character'} · ${offer.role}`
  const CLOSED_MESSAGES = {
    filled: 'Someone else accepted the place you were offered first.',
    withdrawn: 'The officers withdrew the place they offered you.',
    expired: 'The place you were offered expired before you answered.',
  }

  async function run(action, message) {
    busy = true
    try {
      await action()
      showToast(message)
    } catch (error) {
      showToast(error.message)
    } finally {
      busy = false
    }
  }

  function join(event) {
    event.preventDefault()
    run(
      () =>
        setStandby(item.weekIso, {
          raidId: item.raidId,
          on: true,
          characterId: characterId || null,
          untilMs: until ? Number(until) : null,
        }),
      'You’re on standby. The officers can offer you a place if one opens.',
    )
  }

  const leave = () =>
    run(
      () => setStandby(item.weekIso, { raidId: item.raidId, on: false }),
      'You left standby. It doesn’t count as a missed raid.',
    )

  const answer = (accept) =>
    run(
      () => answerOffer(item.weekIso, open.id, accept),
      accept
        ? 'Place accepted. The officers will add you to the roster.'
        : 'Offer declined. The officers can offer it to someone else.',
    )
</script>

{#if week}
  <div class="standby">
    {#if open}
      <div class="offer" role="group" aria-label={`Place offered in ${item.raid.name}`}>
        <p>
          <strong>You’re offered a place: {placeLabel(open)}.</strong>
          Answer by {at(Date.parse(open.expires_at))} ({timeLeft(open.expires_at, now)}).
        </p>
        <div class="buttons">
          <button class="primary" disabled={busy} onclick={() => answer(true)}>Accept the place</button>
          <button disabled={busy} onclick={() => answer(false)}>Decline</button>
        </div>
      </div>
    {:else if accepted}
      <p class="status" role="status">
        You accepted a place as {placeLabel(accepted)}. The officers will add you to the roster and publish
        it; you won’t be asked to confirm again.
      </p>
    {:else}
      {#if closed}<p class="note">{CLOSED_MESSAGES[offerStatus(closed, now)]}</p>{/if}
      {#if mine}
        <p class="status" role="status">
          You’re on standby{mine.character_id
            ? ` with ${characterById(app.data, mine.character_id)?.name ?? 'your character'}`
            : ''}{mine.until_ms === null ? '' : `, reachable until ${at(Number(mine.until_ms))}`}.
        </p>
        <button disabled={busy} onclick={leave}>Leave standby</button>
      {:else if untilOptions.length}
        <form class="join" onsubmit={join} aria-label={`Standby for ${item.raid.name}`}>
          <label class="field"
            >Character
            <select bind:value={characterId}>
              <option value="">Any of mine</option>
              {#each characters as character (character.id)}<option value={character.id}
                  >{character.name} · {character.role}</option
                >{/each}
            </select></label
          >
          <label class="field"
            >Reachable
            <select bind:value={until}>
              {#each untilOptions as option (option.label)}<option value={option.value ?? ''}
                  >{option.label}</option
                >{/each}
            </select></label
          >
          <button disabled={busy}>Be on standby</button>
        </form>
      {/if}
    {/if}
    {#if week.error}<p class="warning">Standby could not be refreshed: {week.error}</p>{/if}
  </div>
{/if}

<style>
  .standby {
    margin-top: 0.75rem;
  }
  .standby p {
    margin: 0 0 0.5rem;
  }
  .offer {
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--gold);
    background: #ffffff05;
  }
  .join {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem 1rem;
  }
</style>
