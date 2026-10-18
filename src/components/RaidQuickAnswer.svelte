<script>
  import { app } from '../lib/app.svelte.js'
  import { checkinsClosed } from '../lib/checkins.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { charactersOf } from '../lib/model.js'
  import { compactSessionLabel } from '../lib/personal-raids.js'
  import { announcedRaids, answerRaid, raidAnswer } from '../lib/raid-answers.js'
  import { saveAppSignup } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { offerUndo, showToast } from '../lib/toast.svelte.js'

  /**
   * One tap per announced raid, like the Discord sign-up buttons. Each answer changes only that raid;
   * the full week editor stays one link away for anything more complicated.
   */
  let { memberId, weekIso, now = Date.now() } = $props()

  const ANSWERS = [
    { id: 'in', label: 'I’m in', done: 'You’re in for' },
    { id: 'tentative', label: 'Tentative', done: 'You’re tentative for' },
    { id: 'out', label: 'Can’t make it', done: 'You’re out of' },
  ]

  const raids = $derived(announcedRaids(app.data, weekIso).filter((item) => item.start > now))
  const characters = $derived(charactersOf(app.data, memberId))
  const closed = $derived(!canManage() && checkinsClosed(app.data, weekIso, now))
  let chosen = $state({})

  function characterFor(raidId) {
    return chosen[raidId] ?? (characters.find((c) => c.main) ?? characters[0])?.id ?? null
  }

  /**
   * Online, the answer also goes on the raid's Discord sign-up list. The check-in is already saved
   * with the guild, so a failure here says so and offers to try the list again.
   */
  async function syncSignup(item, answer, characterId) {
    if (!remote.guildId) return
    const args = { weekIso, raidId: item.raid.id, memberId, answer, characterId }
    try {
      await saveAppSignup(supabase, remote.guildId, args)
    } catch (error) {
      showToast(`Your answer is saved, but the Discord sign-up list didn’t update: ${error.message}`, {
        label: 'Try again',
        run: () => syncSignup(item, answer, characterId),
      })
    }
  }

  function answer(item, choice) {
    if (closed) return
    const previous = app.data
    const before = raidAnswer(previous, weekIso, memberId, item)
    const characterId = choice.id === 'out' || characters.length < 2 ? null : characterFor(item.raid.id)
    app.data = answerRaid(app.data, weekIso, memberId, item, choice.id, characterId)
    void syncSignup(item, choice.id, characterId)
    offerUndo(`${choice.done} ${item.raid.name}.`, previous, () => void syncSignup(item, before, null))
  }
</script>

{#if raids.length}
  <section class="quick-answers" aria-label="Answer this week’s raids">
    <h3>This week’s raids</h3>
    {#if closed}
      <p class="note">Check-ins have closed. Ask an officer if your answer needs to change.</p>
    {/if}
    {#each raids as item (item.raid.id)}
      {@const current = raidAnswer(app.data, weekIso, memberId, item)}
      <div class="quick-raid">
        <p>
          <strong>{item.raid.name}</strong>
          <small>{compactSessionLabel(item, viewerZone)}</small>
        </p>
        {#if characters.length > 1}
          <label class="field">
            Character
            <select
              value={characterFor(item.raid.id)}
              onchange={(event) => (chosen = { ...chosen, [item.raid.id]: event.currentTarget.value })}
            >
              {#each characters as character (character.id)}
                <option value={character.id}>{character.name} · {character.spec}</option>
              {/each}
            </select>
          </label>
        {/if}
        <div class="buttons" role="group" aria-label={`Your answer for ${item.raid.name}`}>
          {#each ANSWERS as choice (choice.id)}
            <button
              aria-pressed={current === choice.id}
              class:primary={choice.id === 'in' && current !== 'in'}
              disabled={closed}
              onclick={() => answer(item, choice)}>{choice.label}</button
            >
          {/each}
        </div>
      </div>
    {/each}
    <p class="note">
      Each answer changes only that raid{remote.guildId ? ' and shows on its Discord sign-up list' : ''}. Use
      My availability for other times.
    </p>
  </section>
{/if}

<style>
  .quick-answers {
    margin-top: 1rem;
  }
  .quick-answers h3 {
    margin: 0 0 0.5rem;
    font-size: 14px;
  }
  .quick-raid {
    padding: 0.5rem 0;
    border-top: 1px solid var(--line, #2b3740);
  }
  .quick-raid p {
    margin: 0 0 0.5rem;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: baseline;
  }
</style>
