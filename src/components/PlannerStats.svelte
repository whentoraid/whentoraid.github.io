<script>
  import Icon from './Icon.svelte'
  /** The planner's headline numbers: check-ins, roster size, and schedule conflicts. */
  let { checkedInCount, playerCount, rosterCount, totalSlots, roleCounts, problemCount } = $props()
</script>

<div class="stats">
  <div class="stat">
    <span class="stat-label"><Icon name="calendar" size={16} /> CHECK-INS</span>
    <strong>{checkedInCount} <span>/ {playerCount}</span></strong>
    <small>Players who checked in this week</small>
    <div class="stat-track" aria-hidden="true">
      <span style:width={`${playerCount ? Math.min(100, (checkedInCount / playerCount) * 100) : 0}%`}></span>
    </div>
  </div>
  <div class="stat">
    <span class="stat-label"><Icon name="members" size={16} /> ROSTER</span>
    <strong>{rosterCount} <span>/ {totalSlots}</span></strong>
    <small>{roleCounts[0]} tanks · {roleCounts[1]} healers · {roleCounts[2]} damage</small>
    <div class="stat-track roster-track" aria-hidden="true">
      <span style:width={`${totalSlots ? Math.min(100, (rosterCount / totalSlots) * 100) : 0}%`}></span>
    </div>
  </div>
  <div class="stat">
    <span class="stat-label"><Icon name="shield" size={16} /> CONFLICTS</span>
    <strong class={problemCount ? 'bad' : 'good'}>{problemCount}</strong>
    <small
      >{problemCount ? 'Review highlighted players below' : 'Everyone selected can make this session'}</small
    >
  </div>
</div>

<style>
  .stat-label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stat-track {
    height: 3px;
    margin-top: 8px;
    background: var(--line);
    border-radius: 3px;
    overflow: hidden;
  }
  .stat-track span {
    display: block;
    height: 100%;
    background: var(--green);
  }
  .roster-track span {
    background: var(--gold);
  }
  @media (max-width: 760px) {
    .stat-label :global(svg) {
      display: none;
    }
    .stat-track {
      display: none;
    }
  }
</style>
