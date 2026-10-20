<script>
  import SectionTabs from '../components/SectionTabs.svelte'
  import AddPlayerDialog from '../components/AddPlayerDialog.svelte'
  import AttendancePanel from '../components/AttendancePanel.svelte'
  import { PRIORITY_LABELS } from '../lib/tradeoffs.js'
  import ManualCopyModal from '../components/ManualCopyModal.svelte'
  import PageTitle from '../components/PageTitle.svelte'
  import PlannerResponses from '../components/PlannerResponses.svelte'
  import PlannerSchedule from '../components/PlannerSchedule.svelte'
  import PlannerStats from '../components/PlannerStats.svelte'
  import PlayerDialog from '../components/PlayerDialog.svelte'
  import PublishIssues from '../components/PublishIssues.svelte'
  import ReplacementDialog from '../components/ReplacementDialog.svelte'
  import RosterBoard from '../components/RosterBoard.svelte'
  import WeekBar from '../components/WeekBar.svelte'
  import RaidSelector from '../components/RaidSelector.svelte'
  import RaidHistoryPanel from '../components/RaidHistoryPanel.svelte'
  import { tick } from 'svelte'
  import {
    copyPreviousRoster,
    hasDraftChanges,
    publishPlan,
    withdrawPlan,
    undoRosterChange,
    publicationChanges,
    publicationIssues,
  } from '../lib/raid-workflow.js'
  import { getRaid, setCurrentRaid } from '../lib/raids.js'
  import { app } from '../lib/app.svelte.js'
  import { markAllAttended, setAttendance, setCancelled } from '../lib/attendance.js'
  import { rosterIcs } from '../lib/calendar.js'
  import { ROLES } from '../lib/constants.js'
  import { downloadText } from '../lib/download.js'
  import { backups, conflicts, isAvailable } from '../lib/engine.js'
  import { displayZone, viewerZone } from '../lib/display.svelte.js'
  import { clampStartSlot, formatSessionHeading, formatSessionIn, slotWindow } from '../lib/grid.js'
  import { characterById, getWeek, setCurrentWeek, setPlan, tracksAttendance } from '../lib/model.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import {
    benchMember,
    formatBackups,
    placeInRoster,
    plannerContext,
    readyRoleCounts,
    rebuildTeam,
    retimeTeam,
    toggleLock,
    topDistinctDays,
  } from '../lib/planning.js'
  import { rosterDiscord, rosterText, splitForDiscord } from '../lib/roster-export.js'
  import { discordChannel, hasDiscordChannel } from '../lib/discord-channel.svelte.js'
  import { createRosterDiscord } from '../lib/roster-discord.svelte.js'
  import { compositionIssues, raidRules } from '../lib/composition-rules.js'
  import { publishedRosterUrl } from '../lib/route.js'
  import { showToast, offerUndo } from '../lib/toast.svelte.js'
  import { reachableStandby } from '../lib/standby.js'
  import { standbyWeek } from '../lib/standby.svelte.js'
  import {
    deliveryStatus,
    needsRetry,
    retryDelivery,
    usesServerDelivery,
  } from '../lib/discord-delivery.svelte.js'

  let activeSection = $state('schedule')
  let showPublished = $state(false)
  const section = $derived(
    !canManage() || (viewPublished && activeSection === 'schedule') ? 'roster' : activeSection,
  )
  // A personal assignment or shared roster link opens the published roster, even if already here;
  // an officer-dashboard issue opens the tool that resolves it.
  $effect(() => {
    const intent = app.plannerIntent
    if (!intent) return
    app.plannerIntent = null
    if (intent === 'published') {
      showPublished = true
      activeSection = 'roster'
    } else void openTool(intent)
  })
  // Leaving the planner forgets the dashboard return, so a later visit does not offer it.
  $effect(() => () => (app.returnTo = null))

  /** @param {import('../lib/officer-dashboard.js').PlannerIntent} intent */
  async function openTool({ section, focus, role }) {
    showPublished = false
    activeSection = section
    if (focus === 'publish') showIssues = true
    if (focus === 'changes') reviewOpen = true
    if (focus === 'add') dialog = { kind: 'add', role }
    await tick()
    // The first of these on the page: problems to resolve come before the Publish button.
    const targets = {
      publish: ['#publish-check', '#publish-roster'],
      changes: ['#publication-review'],
      checkins: ['#checkin-heading'],
      attendance: ['#attendance-heading'],
    }[focus]
    const element = targets?.map((id) => document.querySelector(id)).find(Boolean)
    element?.scrollIntoView?.({ block: 'center' })
    if (element instanceof HTMLElement) element.focus({ preventScroll: true })
  }

  function backToDashboard() {
    app.dashboardFocus = app.returnTo
    app.view = 'officer'
  }
  const tabs = $derived([
    ...(!viewPublished ? [{ id: 'schedule', label: 'Schedule', icon: 'calendar' }] : []),
    { id: 'roster', label: 'Roster', icon: 'members', count: plan.team.length },
    ...(canManage() ? [{ id: 'responses', label: 'Responses', icon: 'check' }] : []),
  ])
  let undoChange = $state(null)
  const viewPublished = $derived(!canManage() || showPublished)
  const published = $derived(getWeek(app.data, app.data.currentWeek).plan?.published)

  const context = $derived(plannerContext(app.data))
  const plan = $derived(viewPublished && published ? { ...published, locked: [], saved: true } : context.plan)
  const players = $derived(context.players)
  const settings = $derived(
    viewPublished && published
      ? {
          ...getRaid(app.data),
          name: published.raidName,
          targets: published.targets,
          durationSlots: (published.end - published.start) / 1800000,
        }
      : getRaid(app.data),
  )
  const guild = $derived(app.data.guild)
  const weekIso = $derived(app.data.currentWeek)
  /** The saved plan carries attendance; the resolved plan above may be an unsaved suggestion. */
  const savedPlan = $derived(getWeek(app.data, weekIso).plan)
  const draftChanged = $derived(hasDraftChanges(app.data, context.plan))
  const changes = $derived(publicationChanges(app.data, context.plan))
  const issues = $derived(publicationIssues(app.data, context.plan, players))
  let showIssues = $state(false)
  let reviewOpen = $state(false)
  let replacementTarget = $state(null)
  const onStandby = $derived(
    new Set(
      reachableStandby(standbyWeek(weekIso)?.standby, app.data.currentRaidId, Date.now()).map(
        (row) => row.member_id,
      ),
    ),
  )
  const inDraft = (memberId) => context.plan.team.some((entry) => entry.memberId === memberId)

  function replaceMember(memberId) {
    showPublished = false
    replacementTarget = memberId
  }

  /** Swap `vacated` for another player in the draft; officers review and publish it after. */
  function replaceInDraft(vacated, entry) {
    const result = placeInRoster(benchMember(context.plan.team, vacated), entry, getRaid(app.data).targets)
    if (result.error) {
      showToast(result.error)
      return false
    }
    rememberChange(
      app.data,
      setPlan(app.data, weekIso, {
        start: context.plan.start,
        team: result.team,
        locked: context.plan.locked.filter((id) => id !== vacated),
      }),
    )
    showToast('Replacement saved in the draft. Review and publish the change when ready.')
    return true
  }

  function confirmReplacement(entry) {
    if (replaceInDraft(replacementTarget, entry)) replacementTarget = null
  }

  /** An accepted offer goes in the draft while the vacated player is still there to swap out. */
  const canPlaceOffer = (offer) => inDraft(offer.vacated_member_id) && !inDraft(offer.member_id)
  const placeAcceptedOffer = (offer) =>
    replaceInDraft(offer.vacated_member_id, {
      memberId: offer.member_id,
      characterId: offer.character_id,
      role: offer.role,
    })

  function rememberChange(previous, next) {
    undoChange = {
      week: weekIso,
      raidId: app.data.currentRaidId,
      before: $state.snapshot(getWeek(previous, weekIso).plan),
      after: $state.snapshot(getWeek(next, weekIso).plan),
    }
    app.data = next
  }

  function undoRoster() {
    if (officersOnly()) return
    const result = undoRosterChange(app.data, undoChange)
    if (result.error) return showToast(result.error)
    app.data = result.state
    undoChange = null
    showToast('Roster change undone.')
  }

  function copyLastWeek() {
    if (officersOnly()) return
    const result = copyPreviousRoster(app.data)
    if (result.error) return showToast(result.error)
    rememberChange(app.data, result.state)
    showToast(
      `Last week’s roster copied as a draft. Check this week’s availability.${result.dropped ? ` ${result.dropped} entries no longer fit and were left out.` : ''}`,
    )
  }

  function publish() {
    if (officersOnly()) return
    showIssues = true
    const previous = app.data
    const result = publishPlan(app.data, context.plan, players)
    if (result.error) return showToast(result.error)
    app.data = result.state
    showIssues = false
    // Say so when nothing goes to Discord, so a missing channel doesn't look like a failed publish.
    const unposted = discordChannel.loaded && !hasDiscordChannel()
    offerUndo(
      unposted
        ? 'Roster published. Not posted to Discord: set a channel in Guild settings to post there.'
        : 'Roster published. Draft edits will stay separate.',
      previous,
    )
    if (!hasDiscordChannel()) return
    // A roster already in Discord follows what was just published; a new one is posted unless unticked.
    if (discord.postedIds.length) void discord.follow(discord.post)
    else if (postOnPublish) void discord.post()
  }

  function withdraw() {
    if (officersOnly()) return
    const previous = app.data
    app.data = withdrawPlan(app.data)
    showPublished = false
    offerUndo('Published roster withdrawn. Your draft is kept.', previous)
    if (hasDiscordChannel() && discord.postedIds.length) void discord.follow(discord.withdraw)
  }

  const totalSlots = $derived(settings.targets.reduce((sum, n) => sum + n, 0))
  const roleCounts = $derived(ROLES.map((role) => plan.team.filter((e) => e.role === role).length))
  const readyCounts = $derived(readyRoleCounts(plan.team, players, plan))
  const checkedInCount = $derived(players.filter((p) => p.checkedIn).length)
  const availableCount = $derived(
    players.filter((p) => isAvailable(p, plan) && p.characters.some((c) => c.offered)).length,
  )
  const problemCount = $derived(plan.team.filter((e) => conflicts(e, players, plan).length > 0).length)
  const topDays = $derived(topDistinctDays(context.suggestions, 3))
  const classCount = $derived(
    new Set(plan.team.map((e) => characterById(app.data, e.characterId)?.class)).size,
  )
  /** The raid's optional class limits and required utilities, as warnings officers may accept. */
  const ruleIssues = $derived(
    compositionIssues(
      plan.team,
      players.flatMap((p) => p.characters),
      settings.rules,
    ),
  )
  const zone = $derived(displayZone(guild))
  const sessionLabel = $derived(formatSessionIn(plan, zone))
  const benchMembers = $derived(app.data.members.filter((m) => !plan.team.some((e) => e.memberId === m.id)))
  const planBackups = $derived(backups(players, plan, plan.team))
  const planThinnest = $derived(
    Math.min(...planBackups.filter((_, i) => settings.targets[i] > 0).concat(Number.POSITIVE_INFINITY)),
  )

  /** @type {{ kind: 'player', memberId: string, role?: string } | { kind: 'add', role: string } | null} */
  let dialog = $state(null)

  /** Rosters and attendance are officers' calls in an online guild; the server enforces it too. */
  function officersOnly() {
    if (canManage()) return false
    showToast('Only officers can change the roster.')
    return true
  }

  /** Locks carry over unless given; setPlan drops locks for anyone no longer on the team. */
  function savePlan(start, team, locked = plan.locked) {
    if (officersOnly() || viewPublished) return
    rememberChange(app.data, setPlan(app.data, weekIso, { start, team, locked }))
  }

  function rebuild() {
    if (officersOnly()) return
    savePlan(plan.start, rebuildTeam(players, plan, settings.targets, plan.team, plan.locked, settings.rules))
    showToast(plan.locked.length ? 'Roster rebuilt around locked players' : 'Roster rebuilt for this session')
  }

  function chooseSuggestion(suggestion) {
    const team = plan.locked.length
      ? rebuildTeam(players, suggestion, settings.targets, plan.team, plan.locked, settings.rules)
      : suggestion.team
    savePlan(suggestion.start, team)
  }

  function lock(memberId) {
    savePlan(plan.start, plan.team, toggleLock(plan.locked, memberId))
  }

  /** Moving the session keeps who can still come (and locked players) and refills the rest. */
  function moveSession(day, slot) {
    if (officersOnly() || viewPublished) return
    const startSlot = clampStartSlot(slot, settings.durationSlots, guild)
    const window = slotWindow(weekIso, day, startSlot, settings.durationSlots, guild)
    const { team, replaced } = retimeTeam(
      players,
      window,
      settings.targets,
      plan.team,
      plan.locked,
      settings.rules,
    )
    savePlan(window.start, team)
    if (replaced) {
      showToast(
        `${replaced} ${replaced === 1 ? 'player' : 'players'} who can’t make this time moved to the bench, and open slots were refilled. “Undo roster change” puts them back.`,
      )
    }
  }

  function place(memberId, characterId, role) {
    const result = placeInRoster(plan.team, { memberId, characterId, role }, settings.targets)
    if ('error' in result) {
      showToast(result.error)
      return
    }
    savePlan(plan.start, result.team)
  }

  function bench(memberId) {
    savePlan(plan.start, benchMember(plan.team, memberId))
  }

  function pickCharacter(character) {
    const role = dialog?.kind === 'player' && dialog.role ? dialog.role : character.role
    dialog = null
    place(character.memberId, character.id, role)
  }

  function benchFromDialog() {
    if (dialog?.kind === 'player') bench(dialog.memberId)
    dialog = null
  }

  // Each dialog clears only its own state, so switching from "add" to "player" is not undone by the close event.
  function closeDialog(kind) {
    if (dialog?.kind === kind) dialog = null
  }

  /** Attendance lives on the saved plan, so an unsaved suggestion is saved first. */
  function ensureSaved() {
    if (!plan.saved) savePlan(plan.start, plan.team)
  }

  function markAttendance(memberId, status) {
    if (officersOnly()) return
    ensureSaved()
    app.data = setAttendance(app.data, weekIso, memberId, status)
  }

  function markEveryone() {
    if (officersOnly()) return
    const previous = app.data
    ensureSaved()
    const next = markAllAttended(app.data, weekIso)
    rememberChange(previous, next)
    offerUndo('Unrecorded players marked attended. Existing exceptions kept.', previous)
  }

  function markCancelled(cancelled) {
    if (officersOnly()) return
    ensureSaved()
    app.data = setCancelled(app.data, weekIso, cancelled)
    showToast(cancelled ? 'Raid marked as cancelled' : 'Raid marked as held')
    if (published && hasDiscordChannel() && discord.postedIds.length) void discord.follow(discord.post)
  }

  /** Messages to copy by hand when the clipboard API is unavailable (e.g. not a secure context). */
  let manualCopyMessages = $state(null)

  /** Copy text for Discord, split into messages that each fit Discord's limit. */
  function copyText(text, successMessage) {
    return copyMessage(splitForDiscord(text), 0, successMessage)
  }

  /** Copy one message; while more remain, the toast offers to copy the next. */
  async function copyMessage(messages, index, successMessage) {
    try {
      await navigator.clipboard.writeText(messages[index])
    } catch {
      manualCopyMessages = messages
      return
    }
    if (messages.length === 1) return showToast(successMessage)
    const next = index + 1
    const more = next < messages.length
    showToast(
      `Copied message ${index + 1} of ${messages.length}. Paste it into Discord${more ? ', then copy the next' : ''}.`,
      more
        ? { label: `Copy message ${next + 1}`, run: () => copyMessage(messages, next, successMessage) }
        : null,
    )
  }

  function copyForDiscord() {
    copyText(rosterDiscord(app.data, plan, players), 'Roster copied. Paste it into Discord.')
  }

  /** Whether publishing a roster that is not in Discord yet also posts it there. */
  let postOnPublish = $state(true)
  const discord = createRosterDiscord(
    () => ({
      week: weekIso,
      raidId: app.data.currentRaidId,
      published,
      cancelled: savedPlan?.cancelled ?? false,
      players,
    }),
    { officersOnly },
  )

  /** A link to this published roster for guild members; it opens the guild after signing in. */
  async function copyRosterLink() {
    const url = publishedRosterUrl(location, remote.guildId, weekIso, app.data.currentRaidId)
    try {
      await navigator.clipboard.writeText(url)
      showToast('Roster link copied. Guild members can open it after signing in.')
    } catch {
      manualCopyMessages = [url]
    }
  }

  function exportRoster() {
    downloadText(`whentoraid-${settings.id}-${weekIso}.txt`, rosterText(app.data, plan, players))
  }

  function exportCalendar() {
    downloadText(`whentoraid-${settings.id}-${weekIso}.ics`, rosterIcs(app.data, plan), 'text/calendar')
  }
</script>

<div class="planner-page">
  <PageTitle
    icon="planner"
    eyebrow={viewPublished ? 'PUBLISHED RAID' : 'RAID PLANNER'}
    title={settings.name}
    subtitle={viewPublished && !published
      ? 'Your officers have not published this raid yet.'
      : formatSessionHeading(plan, guild.timezone, viewerZone)}
  >
    {#snippet action()}<RaidSelector />{/snippet}
  </PageTitle>

  {#if app.returnTo}<button class="text-button back-link" onclick={backToDashboard}
      ><span aria-hidden="true">←</span> Back to officer dashboard</button
    >{/if}

  <div class="planning-context"><WeekBar /></div>

  <section class="publication-bar" aria-label="Roster publication">
    <div class="publication-toolbar">
      <span class="badge" class:published={viewPublished && !!published}
        >{published
          ? viewPublished
            ? 'Published roster'
            : draftChanged
              ? 'Draft changes pending'
              : 'Draft matches published'
          : 'Not published'}</span
      >
      {#if canManage()}
        <div class="buttons">
          <div class="segmented">
            <button
              aria-label="Edit draft"
              aria-pressed={!viewPublished}
              onclick={() => (showPublished = false)}>Draft</button
            >
            <button
              aria-label="View published roster"
              aria-pressed={viewPublished}
              onclick={() => (showPublished = true)}>Published</button
            >
          </div>
          {#if !viewPublished}<button
              id="publish-roster"
              class="primary"
              disabled={published && !draftChanged}
              onclick={publish}>{published ? 'Publish draft changes' : 'Publish roster'}</button
            >{/if}
          {#if !viewPublished && hasDiscordChannel() && !discord.postedIds.length}<label class="checkbox-row"
              ><input type="checkbox" bind:checked={postOnPublish} />Also post to Discord</label
            >{/if}
        </div>
      {/if}
    </div>
    <details class="publication-options">
      <summary>Publication &amp; sharing options</summary>
      <p role="status" class="note">
        {!published
          ? 'No published roster for this raid yet.'
          : draftChanged
            ? 'Published roster is available. Draft changes have not been published.'
            : 'The draft matches the published roster.'}
        {viewPublished
          ? 'Viewing the published roster. Player confirmations are separate.'
          : 'Editing the draft. Changes save automatically.'}
        {#if canManage() && hasDiscordChannel() && discord.postedIds.length}Posted to Discord; publishing
          draft changes updates the post.
        {:else if canManage() && discordChannel.loaded && !hasDiscordChannel()}Set a Discord channel in Guild
          settings to post rosters there directly.{/if}
      </p>
      {#if published && remote.guildId}
        <div class="buttons"><button onclick={copyRosterLink}>Copy roster link</button></div>
      {/if}
      {#if canManage()}
        <div class="buttons">
          {#if published}<button onclick={withdraw}>Withdraw published roster</button>{/if}
          {#if hasDiscordChannel() && published}<button disabled={discord.posting} onclick={discord.post}
              >{discord.postedIds.length ? 'Update Discord post' : 'Post to Discord'}</button
            >{/if}
          {#if hasDiscordChannel() && discord.postedIds.length}<button
              onclick={discord.remove}
              disabled={discord.posting}>Delete Discord post</button
            >{/if}
        </div>
        {#if plan.team.length}<label class="checkbox-row"
            ><input
              type="checkbox"
              checked={savedPlan?.cancelled ?? false}
              onchange={(event) => markCancelled(event.currentTarget.checked)}
            />Raid was cancelled</label
          >{/if}
      {/if}
    </details>
    {#if canManage() && usesServerDelivery() && deliveryStatus(discord.delivery)}
      <p class:warning={needsRetry(discord.delivery)} role="status">
        {deliveryStatus(discord.delivery)}
        {#if needsRetry(discord.delivery)}<button
            disabled={discord.posting}
            onclick={() => discord.serverAction(() => retryDelivery(weekIso, app.data.currentRaidId))}
            >Retry Discord post</button
          >{/if}
      </p>
    {/if}
    {#if savedPlan?.cancelled}<p class="warning" role="status">This raid is cancelled.</p>{/if}
    {#if canManage() && !viewPublished && published && draftChanged}
      <details class="publication-review" bind:open={reviewOpen}>
        <summary id="publication-review" tabindex="-1">Review changes to publish</summary>
        <section aria-label="Changes to publish">
          <h3>Changes to publish</h3>
          <ul>
            {#each changes as change, i (i)}
              <li>
                {change.kind === 'time'
                  ? `Time: ${formatSessionIn(change.before, zone)} → ${formatSessionIn(change.after, zone)}`
                  : change.message}
              </li>
            {/each}
          </ul>
        </section>
      </details>
    {/if}
    {#if canManage() && !viewPublished && showIssues && issues.length}
      <PublishIssues
        {issues}
        ondialog={(next) => (dialog = next)}
        onrestore={() => markCancelled(false)}
        onopenoverlap={(issue) => {
          app.data = setCurrentRaid(setCurrentWeek(app.data, issue.week), issue.raidId)
          showIssues = false
        }}
      />
    {/if}
  </section>

  {#if !viewPublished || published}
    <PlannerStats
      {checkedInCount}
      playerCount={players.length}
      rosterCount={plan.team.length}
      {totalSlots}
      {roleCounts}
      {problemCount}
    />
  {/if}

  <SectionTabs
    id="planner"
    label="Planning workspace"
    {tabs}
    value={section}
    onselect={(value) => (activeSection = value)}
  />

  {#if !viewPublished}
    <div
      id="planner-panel-schedule"
      class="planner-section"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="planner-tab-schedule"
      hidden={section !== 'schedule'}
    >
      <PlannerSchedule
        {weekIso}
        {guild}
        {settings}
        {plan}
        {savedPlan}
        {players}
        suggestions={context.suggestions}
        {topDays}
        {checkedInCount}
        {totalSlots}
        {zone}
        {sessionLabel}
        priorityLabel={PRIORITY_LABELS[raidRules(getRaid(app.data)).priority]}
        readiness={{
          roleCounts,
          readyCounts,
          availableCount,
          backupsLabel: formatBackups(planBackups),
          backupsOk: planThinnest > 0,
          lockedCount: plan.locked.length,
          problemCount,
          classCount,
        }}
        oncopy={copyText}
        onchoose={chooseSuggestion}
        onmove={moveSession}
        onreview={() => (activeSection = 'roster')}
      />
    </div>
  {/if}

  <div
    id="planner-panel-roster"
    class="planner-section"
    role="tabpanel"
    tabindex="0"
    aria-labelledby="planner-tab-roster"
    hidden={section !== 'roster'}
  >
    {#if !viewPublished || published}
      <div class="section-head roster-header">
        <div>
          <h2>Your raid roster</h2>
          <p class="subtitle">
            {viewPublished
              ? 'Published assignment · attendance is confirmed separately'
              : 'Draft · changes save automatically'}
          </p>
        </div>
        <details class="export-options">
          <summary>Share &amp; export</summary>
          <div class="buttons">
            <button onclick={copyForDiscord}>Copy for Discord</button><button onclick={exportCalendar}
              >Add to calendar (.ics)</button
            ><button onclick={exportRoster}>Download .txt ↓</button>
          </div>
        </details>
      </div>
      {#if !viewPublished}<div class="roster-tools buttons">
          <button onclick={rebuild}>↻ Rebuild roster</button><button onclick={copyLastWeek}
            >Copy last week’s roster</button
          >{#if undoChange && undoChange.week === weekIso && undoChange.raidId === app.data.currentRaidId}<button
              onclick={undoRoster}>Undo roster change</button
            >{/if}
        </div>{/if}
      {#if ruleIssues.length}
        <ul class="rule-issues warning" role="status" aria-label="Composition rules">
          {#each ruleIssues as issue, i (i)}<li>{issue.message}</li>{/each}
        </ul>
      {/if}
      <RosterBoard
        team={plan.team}
        {players}
        window={plan}
        targets={settings.targets}
        onplace={place}
        onbench={bench}
        onedit={(memberId) => (dialog = { kind: 'player', memberId })}
        onadd={(role) => (dialog = { kind: 'add', role })}
        locked={plan.locked}
        onlock={lock}
        readonly={viewPublished}
      />

      {#if plan.team.length && !viewPublished && tracksAttendance(app.data)}
        <AttendancePanel
          team={plan.team}
          attendance={savedPlan?.attendance ?? {}}
          cancelled={savedPlan?.cancelled ?? false}
          onmark={markAttendance}
          onall={markEveryone}
        />
      {/if}
      {#if canManage() && remote.guildId && !viewPublished}
        <RaidHistoryPanel {weekIso} raidId={app.data.currentRaidId} {zone} />
      {/if}
    {:else}<div class="panel empty-state">
        <h2>No published roster yet</h2>
        <p>Your officers are still planning this raid. Your assignment will appear once they publish.</p>
      </div>{/if}
  </div>

  {#if canManage()}
    <div
      id="planner-panel-responses"
      class="planner-section"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="planner-tab-responses"
      hidden={section !== 'responses'}
    >
      <PlannerResponses
        week={weekIso}
        raidId={app.data.currentRaidId}
        {published}
        cancelled={savedPlan?.cancelled ?? false}
        active={section === 'responses'}
        {zone}
        canReplace={inDraft}
        onreplace={replaceMember}
        {canPlaceOffer}
        onplaceoffer={placeAcceptedOffer}
        onreviewdraft={() => {
          showPublished = false
          activeSection = 'roster'
        }}
      />
    </div>
  {/if}
</div>

<AddPlayerDialog
  open={dialog?.kind === 'add'}
  role={dialog?.kind === 'add' ? dialog.role : null}
  {benchMembers}
  onchoose={(memberId) => (dialog = { kind: 'player', memberId, role: dialog.role })}
  onclose={() => closeDialog('add')}
/>

<PlayerDialog
  {plan}
  {players}
  open={dialog?.kind === 'player'}
  memberId={dialog?.kind === 'player' ? dialog.memberId : null}
  inTeam={dialog?.kind === 'player' && plan.team.some((e) => e.memberId === dialog.memberId)}
  onpick={pickCharacter}
  onbench={benchFromDialog}
  onclose={() => closeDialog('player')}
/>

<ManualCopyModal messages={manualCopyMessages} onclose={() => (manualCopyMessages = null)} />

<ReplacementDialog
  memberId={replacementTarget}
  plan={context.plan}
  {players}
  {onStandby}
  onconfirm={confirmReplacement}
  onclose={() => (replacementTarget = null)}
/>

<style>
  .publication-review {
    margin: 1rem 0;
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--gold);
    background: #ffffff05;
  }
  .publication-review li {
    margin: 0.5rem 0;
  }
  .back-link {
    margin-bottom: 0.5rem;
  }
  .rule-issues {
    margin: 0.75rem 0;
    padding-left: 1.25rem;
  }
</style>
