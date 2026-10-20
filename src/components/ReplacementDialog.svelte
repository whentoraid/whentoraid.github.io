<script>
  import Modal from './Modal.svelte'
  import { app } from '../lib/app.svelte.js'
  import { isAvailable } from '../lib/engine.js'
  import { characterById, memberById } from '../lib/model.js'

  /**
   * Choosing who replaces `memberId` in the draft: available players offering the same role, with
   * those on standby first. `onStandby` is the set of member IDs who said they're on standby.
   */
  let { memberId, plan, players, onStandby, onconfirm, onclose } = $props()

  const entry = $derived(plan.team.find((e) => e.memberId === memberId))
  const options = $derived(
    entry
      ? players
          .filter((player) => !plan.team.some((e) => e.memberId === player.id) && isAvailable(player, plan))
          .flatMap((player) =>
            player.characters
              .filter((character) => character.offered && character.role === entry.role)
              .map((character) => ({ player, character, standby: onStandby.has(player.id) })),
          )
          // Players who said they're on standby come first.
          .sort((a, b) => Number(b.standby) - Number(a.standby))
      : [],
  )
  const name = $derived(memberById(app.data, memberId)?.name ?? 'player')
</script>

<Modal open={memberId !== null} {onclose} label={`Replace ${name}`}>
  <h2>Replace {name}</h2>
  <p>Available players offering the same role, excluding other published commitments.</p>
  <div class="modal-list">
    {#each options as option (option.character.id)}
      <button
        onclick={() =>
          onconfirm({ memberId: option.player.id, characterId: option.character.id, role: entry.role })}
      >
        <strong>{characterById(app.data, option.character.id)?.name}</strong>
        <small
          >{option.standby ? 'On standby · ' : ''}{memberById(app.data, option.player.id)?.name} · {option
            .character.role}</small
        >
      </button>
    {:else}
      <p class="note">
        No eligible replacement for this role at this time. Review availability or choose another session.
      </p>
    {/each}
  </div>
</Modal>
