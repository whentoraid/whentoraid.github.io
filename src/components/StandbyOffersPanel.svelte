<script>
  import { app } from '../lib/app.svelte.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { characterById, memberById } from '../lib/model.js'
  import {
    DEFAULT_OFFER_HOURS,
    OFFER_HOURS,
    offerCandidates,
    offerDeadline,
    offerStatus,
    reachableStandby,
    timeLeft,
  } from '../lib/standby.js'
  import { loadStandbyWeek, offerPlace, standbyWeek, withdrawOffer } from '../lib/standby.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  /**
   * Officers, online guilds: who is on standby for the published raid, offering a published place to
   * someone else, and putting a player who accepted into the draft. Accepting never changes the
   * published roster, so officers still review and publish.
   * `canPlace(offer)` says whether the draft still has the vacated player to swap out.
   */
  let { week, raidId, published, byMember, canPlace, onplace } = $props()

  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(timer)
  })
  $effect(() => {
    void loadStandbyWeek(week)
  })

  const loaded = $derived(standbyWeek(week))
  const standby = $derived(reachableStandby(loaded?.standby, raidId, now))
  const offers = $derived((loaded?.offers ?? []).filter((offer) => offer.raid_id === raidId))
  /** Places whose player can't make it come first: they are the ones usually offered. */
  const places = $derived(
    [...published.team].sort(
      (a, b) =>
        Number(byMember[b.memberId]?.status === 'unavailable') -
        Number(byMember[a.memberId]?.status === 'unavailable'),
    ),
  )

  let vacated = $state('')
  let candidate = $state('')
  let hours = $state(DEFAULT_OFFER_HOURS)
  let busy = $state(false)
  const place = $derived(places.find((entry) => entry.memberId === vacated) ?? null)
  const candidates = $derived(place ? offerCandidates(app.data, published, place.role, standby) : [])

  const name = (memberId) => memberById(app.data, memberId)?.name ?? 'Removed player'
  const characterName = (id) => characterById(app.data, id)?.name ?? 'Character'
  const at = (instant) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: viewerZone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant)
  const STATUS_LABELS = {
    open: 'waiting',
    accepted: 'accepted',
    declined: 'declined',
    withdrawn: 'withdrawn',
    filled: 'someone else accepted',
    expired: 'expired',
  }

  async function run(action, message) {
    busy = true
    try {
      await action()
      showToast(message)
      return true
    } catch (error) {
      showToast(error.message)
      return false
    } finally {
      busy = false
    }
  }

  async function offer(event) {
    event.preventDefault()
    const choice = candidates.find((option) => option.character.id === candidate)
    if (!place || !choice) return showToast('Choose a place and a player to offer it to.')
    const done = await run(
      () =>
        offerPlace(week, {
          raidId,
          vacatedMemberId: place.memberId,
          memberId: choice.member.id,
          characterId: choice.character.id,
          expiresAt: offerDeadline(Date.now(), hours, published.start),
        }),
      `Place offered to ${choice.member.name}. They’ll see it on My raids.`,
    )
    if (done) candidate = ''
  }
</script>

<section class="panel spaced-top" aria-label="Standby and offers">
  <h2>Standby and offers</h2>
  {#if !loaded}
    <p role="status">Loading standby…</p>
  {:else}
    {#if loaded.error}<p class="warning">Standby could not be refreshed: {loaded.error}</p>{/if}
    {#if standby.length}
      <ul class="standby">
        {#each standby as row (row.member_id)}
          <li>
            <strong>{name(row.member_id)}</strong>
            <small
              >{row.character_id ? characterName(row.character_id) : 'Any character'}{row.until_ms === null
                ? ''
                : ` · until ${at(Number(row.until_ms))}`}</small
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p class="note">No one is on standby yet. Players without a place can join from My raids.</p>
    {/if}

    <form class="offer-form" onsubmit={offer} aria-label="Offer a place">
      <label class="field"
        >Place
        <select bind:value={vacated} onchange={() => (candidate = '')}>
          <option value="">Choose a place</option>
          {#each places as entry (entry.memberId)}<option value={entry.memberId}
              >{name(entry.memberId)} · {entry.role}{byMember[entry.memberId]?.status === 'unavailable'
                ? ' (can’t make it)'
                : ''}</option
            >{/each}
        </select></label
      >
      <label class="field"
        >Offer to
        <select bind:value={candidate} disabled={!place}>
          <option value="">Choose a player</option>
          {#each candidates as option (option.character.id)}<option value={option.character.id}
              >{option.standby ? 'On standby: ' : ''}{option.member.name} · {option.character.name}</option
            >{/each}
        </select></label
      >
      <label class="field"
        >Answer within
        <select bind:value={hours}>
          {#each OFFER_HOURS as value (value)}<option {value}>{value} {value === 1 ? 'hour' : 'hours'}</option
            >{/each}
        </select></label
      >
      <button disabled={busy || !candidate}>Offer place</button>
    </form>
    <p class="note">
      The first to accept takes the place and the others’ offers close. Offers end when the raid starts.
    </p>

    {#if offers.length}
      <ul class="offers">
        {#each offers as item (item.id)}
          {@const status = offerStatus(item, now)}
          <li>
            <span>
              <strong>{name(item.member_id)}</strong> for {name(item.vacated_member_id)}’s {item.role} place
              <small
                >{characterName(item.character_id)} · {STATUS_LABELS[status]}{status === 'open'
                  ? ` · ${timeLeft(item.expires_at, now)}`
                  : ''}</small
              >
            </span>
            {#if status === 'accepted' && canPlace(item)}
              <button class="primary" onclick={() => onplace(item)}
                >Put {name(item.member_id)} in the draft</button
              >
            {/if}
            {#if status === 'open' || status === 'accepted'}
              <button
                disabled={busy}
                onclick={() => run(() => withdrawOffer(week, item.id), 'Offer withdrawn.')}>Withdraw</button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
    margin: 0.5rem 0;
  }
  .offers li > span {
    flex: 1 1 16rem;
  }
  small {
    display: block;
    opacity: 0.8;
  }
  .offer-form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem 1rem;
    margin-top: 1rem;
  }
</style>
