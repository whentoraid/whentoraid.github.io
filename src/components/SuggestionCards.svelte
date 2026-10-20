<script>
  import { formatDateIn, formatTimesIn } from '../lib/grid.js'
  import { formatBackups, formatMissing, missingRoles } from '../lib/planning.js'
  import Icon from './Icon.svelte'

  /** The top raid windows as cards; choosing one calls `onchoose(suggestion)`. */
  let { suggestions, checkedInCount, totalSlots, targets, selectedStart, zone, onchoose } = $props()
</script>

{#if checkedInCount === 0}
  <p class="note empty-week">
    Nobody has checked in for this week yet, so there is nothing to rank. Copy the reminder from the Check-ins
    panel and post it in Discord.
  </p>
{:else}
  <div class="candidates">
    {#each suggestions as suggestion, i (suggestion.day)}
      {@const missing = formatMissing(missingRoles(suggestion.team, targets))}
      <button
        class="candidate"
        class:selected={suggestion.start === selectedStart}
        aria-pressed={suggestion.start === selectedStart}
        onclick={() => onchoose(suggestion)}
      >
        <span class="rank"
          >{i === 0 ? '✦ TOP SUGGESTION' : `ALTERNATIVE 0${i}`}<span class="selection-mark" aria-hidden="true"
            >{#if suggestion.start === selectedStart}<Icon name="check" size={14} />{/if}</span
          ></span
        >
        <b>{formatDateIn(suggestion, zone)}</b>
        <small>{formatTimesIn(suggestion, zone)}</small>
        <span class="count">{suggestion.team.length} / {totalSlots} roles filled</span>
        <span class="candidate-fill" aria-hidden="true"
          ><span
            style:width={`${totalSlots ? Math.min(100, (suggestion.team.length / totalSlots) * 100) : 0}%`}
          ></span></span
        >
        {#if missing}<small class="short">{missing}</small>{/if}
        <small class="backups">Backups: {formatBackups(suggestion.backups)}</small>
      </button>
    {/each}
  </div>
{/if}

<style>
  .rank {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }
  .selection-mark {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 1px solid var(--line);
    border-radius: 50%;
    flex-shrink: 0;
  }
  .selected .selection-mark {
    background: var(--gold);
    border-color: var(--gold);
    color: #211b10;
  }
  .candidate-fill {
    display: block;
    height: 3px;
    background: var(--line);
    margin: 10px 0;
    border-radius: 3px;
    overflow: hidden;
  }
  .candidate-fill > span {
    display: block;
    height: 100%;
    background: var(--green);
  }
  @media (max-width: 760px) {
    .candidate-fill {
      grid-column: 1 / -1;
      grid-row: 5;
      margin-block: 8px 0;
    }
  }
</style>
