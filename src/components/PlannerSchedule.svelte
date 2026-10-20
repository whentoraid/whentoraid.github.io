<script>
  import CheckinPanel from './CheckinPanel.svelte'
  import Heatmap from './Heatmap.svelte'
  import ReadinessPanel from './ReadinessPanel.svelte'
  import SuggestionCards from './SuggestionCards.svelte'
  import TradeoffComparison from './TradeoffComparison.svelte'
  import WeeklyOverview from './WeeklyOverview.svelte'

  /**
   * The planner's Schedule tab: the best session windows, the full availability map, and the
   * readiness of the chosen session. `readiness` holds ReadinessPanel's props.
   */
  let {
    weekIso,
    guild,
    settings,
    plan,
    savedPlan,
    players,
    suggestions,
    topDays,
    checkedInCount,
    totalSlots,
    zone,
    sessionLabel,
    priorityLabel,
    readiness,
    oncopy,
    onchoose,
    onmove,
    onreview,
  } = $props()
</script>

<div class="schedule-layout">
  <div>
    <div class="section-head">
      <div>
        <span class="eyebrow gold">FIND YOUR RAID NIGHT</span>
        <h2>The best windows</h2>
        <p class="subtitle">Choose a time, then fine-tune your roster.</p>
      </div>
    </div>
    <SuggestionCards
      suggestions={topDays}
      {checkedInCount}
      {totalSlots}
      targets={settings.targets}
      selectedStart={plan.start}
      {zone}
      {onchoose}
    />
    <TradeoffComparison
      suggestions={topDays}
      all={suggestions}
      {savedPlan}
      {players}
      {zone}
      {priorityLabel}
    />
    <div class="schedule-next">
      <span>Selected: <strong>{sessionLabel}</strong></span><button class="primary" onclick={onreview}
        >Review roster →</button
      >
    </div>
    <details class="disclosure availability-map">
      <summary><span>Explore guild availability</span><small>Compare every start time</small></summary>
      <div class="disclosure-content">
        <h3>Guild availability</h3>
        <p class="small-text">Each cell shows a full session starting at that time.</p>
        <Heatmap
          {weekIso}
          grid={guild}
          {players}
          {suggestions}
          targets={settings.targets}
          selection={plan}
          durationSlots={settings.durationSlots}
          onselect={onmove}
        />
      </div>
    </details>
    <details class="disclosure">
      <summary>This week’s other raids</summary><WeeklyOverview publishedOnly={false} />
    </details>
  </div>
  <div class="planning-side">
    <CheckinPanel {oncopy} />
    <ReadinessPanel {sessionLabel} targets={settings.targets} {...readiness} />
  </div>
</div>
