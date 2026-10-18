<script>
  import CharacterDialog from '../components/CharacterDialog.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import { app } from '../lib/app.svelte.js'
  import { CLASS_COLORS } from '../lib/constants.js'
  import { characterById, charactersOf, setMainCharacter } from '../lib/model.js'
  import { hasGivenAvailability } from '../lib/personal-raids.js'
  import { showToast } from '../lib/toast.svelte.js'

  function makeMain(character) {
    app.data = setMainCharacter(app.data, app.data.currentMemberId, character.id)
    showToast(`${character.name} is now your main.`)
  }

  /** null: dialog closed. { characterId: null }: adding. { characterId }: editing. */
  let editing = $state(null)

  const myCharacters = $derived(charactersOf(app.data, app.data.currentMemberId))
  const needsAvailability = $derived(
    !hasGivenAvailability(app.data, app.data.currentWeek, app.data.currentMemberId),
  )
  const editingCharacter = $derived(
    editing?.characterId ? characterById(app.data, editing.characterId) : null,
  )
</script>

<PageTitle
  eyebrow="YOUR ADVENTURERS"
  title="My characters"
  subtitle="Manage your main and alts. Choose who to bring on My availability."
>
  {#snippet action()}
    <button class="primary" onclick={() => (editing = { characterId: null })}>+ Add character</button>
  {/snippet}
</PageTitle>

{#if !myCharacters.length}
  <section class="panel" aria-label="Your first character">
    <h2>Add the character you want to raid with</h2>
    <p>
      Your officers need a character and role before they can include you in a roster. Start with one; you can
      add alts later.
    </p>
    <button class="primary" onclick={() => (editing = { characterId: null })}>Add my first character</button>
  </section>
{:else if needsAvailability}
  <section class="panel" aria-label="Next setup step">
    <h2>Your character is ready</h2>
    <p>
      Next, let your officers know when you can raid. You can also tell them you’re unavailable this week.
    </p>
    <button class="primary" onclick={() => (app.view = 'availability')}>Continue to availability</button>
  </section>
{/if}

<div class="character-list">
  {#each myCharacters as character (character.id)}
    <div class="character-card" style:--class={CLASS_COLORS[character.class]}>
      <span class="badge">{character.main ? 'MAIN' : 'ALT'}</span>
      <h2>{character.name}</h2>
      <p>{character.spec} {character.class}</p>
      <small>{character.realm} · {character.role}</small>
      <div class="buttons spaced-top">
        <button onclick={() => (editing = { characterId: character.id })}>Edit character</button>
        {#if !character.main}
          <button onclick={() => makeMain(character)}>Make main</button>
        {/if}
      </div>
    </div>
  {/each}
</div>

<CharacterDialog open={editing !== null} character={editingCharacter} onclose={() => (editing = null)} />
