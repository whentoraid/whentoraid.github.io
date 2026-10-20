<script>
  import PageTitle from '../components/PageTitle.svelte'
  import Icon from '../components/Icon.svelte'
  import OnboardingChecklist from '../components/OnboardingChecklist.svelte'
  import InlineSaveStatus from '../components/InlineSaveStatus.svelte'
  import RaidResponse from '../components/RaidResponse.svelte'
  import RaidQuickAnswer from '../components/RaidQuickAnswer.svelte'
  import StandbyOffer from '../components/StandbyOffer.svelte'
  import ActionInbox from '../components/ActionInbox.svelte'
  import ReminderPreferences from '../components/ReminderPreferences.svelte'
  import RaidRecord from '../components/RaidRecord.svelte'
  import RaidBriefing from '../components/RaidBriefing.svelte'
  import RaidChangeLog from '../components/RaidChangeLog.svelte'
  import { raidAnchor, SCHEDULE_REVIEW_ANCHOR } from '../lib/action-inbox.js'
  import CalendarSubscription from '../components/CalendarSubscription.svelte'
  import RaidMonth from '../components/RaidMonth.svelte'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { app } from '../lib/app.svelte.js'
  import { viewerZone } from '../lib/display.svelte.js'
  import { confirmAvailabilityTemplate, getCheckin, memberById } from '../lib/model.js'
  import { templateConfirmedOn, templateNeedsReview } from '../lib/availability-template.js'
  import { own } from '../lib/ids.js'
  import { showToast } from '../lib/toast.svelte.js'
  import { personalRaids, availabilitySource, compactSessionLabel } from '../lib/personal-raids.js'
  import { weekStatus } from '../lib/raid-status.js'
  import { standbyOnline } from '../lib/standby.svelte.js'
  import { formatMonthDay, mondayOf, todayIso } from '../lib/time.js'

  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(timer)
  })
  const memberId = $derived(app.data.currentMemberId)
  const member = $derived(memberById(app.data, memberId))
  const thisWeek = $derived(mondayOf(todayIso(app.data.guild.timezone, now)))
  const upcoming = $derived(personalRaids(app.data, memberId, now))
  const assigned = $derived(upcoming.filter((item) => item.assignment))
  const next = $derived(assigned[0])
  const checkin = $derived(getCheckin(app.data, thisWeek, memberId))
  const later = $derived(upcoming.filter((item) => item !== next))
  const datePart = (instant, options) =>
    new Intl.DateTimeFormat('en-US', { timeZone: viewerZone, ...options }).format(instant)

  function openRaid(item) {
    app.data = { ...app.data, currentWeek: item.weekIso, currentRaidId: item.raidId }
    app.plannerIntent = 'published'
    app.view = 'planner'
  }

  const template = $derived(own(app.data.templates, memberId))
  const reviewDue = $derived(templateNeedsReview(template, todayIso(app.data.guild.timezone, now)))

  function confirmSchedule() {
    app.data = confirmAvailabilityTemplate(app.data, memberId, now)
    showToast('Thanks. Your usual schedule is confirmed.')
  }

  function checkIn() {
    app.data = { ...app.data, currentWeek: thisWeek }
    app.view = 'availability'
  }

  // Onboarding stage 5: the calendar link is offered once there is a raid worth following.
  const online = $derived(Boolean(remote.guildId) && remote.memberId === memberId)
  let calendarPanel = $state()
  function showCalendar() {
    calendarPanel.open = true
    calendarPanel.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    calendarPanel.querySelector('summary')?.focus({ preventScroll: true })
  }

  /** The page is long, especially on a phone; these jump straight to each part of it. */
  const sections = $derived([
    { id: 'home-next', label: 'Next raid' },
    { id: 'home-availability', label: 'Availability' },
    ...(later.length ? [{ id: 'home-upcoming', label: 'Upcoming' }] : []),
    { id: 'home-month', label: 'Month' },
    ...(online ? [{ id: 'home-settings', label: 'History & settings' }] : []),
  ])
  function jump(id) {
    const target = document.getElementById(id)
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    target?.focus({ preventScroll: true })
  }
</script>

<PageTitle
  icon="shield"
  eyebrow={member ? `YOUR RAID WEEK · ${member.name}` : 'YOUR RAID WEEK'}
  title="My raids"
  subtitle={`Your assignments and availability, in ${viewerZone.replaceAll('_', ' ')}.`}
>
  {#snippet action()}
    <button class="primary title-action" onclick={checkIn}
      ><Icon name="calendar" size={18} /> Edit my availability</button
    >
  {/snippet}
</PageTitle>

<nav class="home-jump" aria-label="On this page">
  {#each sections as section (section.id)}
    <button onclick={() => jump(section.id)}>{section.label}</button>
  {/each}
  {#if canManage()}
    <button class="text-button" onclick={() => (app.view = 'officer')}
      >Open officer dashboard <span aria-hidden="true">→</span></button
    >
  {/if}
</nav>

<ActionInbox {memberId} {thisWeek} {now} onavailability={checkIn} />

<div class="home-priorities jump-target" id="home-next" tabindex="-1">
  <section
    class="panel next-raid"
    aria-label="Next raid assignment"
    id={next ? raidAnchor(next.weekIso, next.raidId) : undefined}
  >
    {#if next}
      <div class="panel-kicker">
        <span class="eyebrow gold">YOUR NEXT RAID</span><Icon name="shield" size={20} />
      </div>
      <div class="next-raid-heading">
        <div class="raid-date" aria-hidden="true">
          <span>{datePart(next.session.start, { weekday: 'short' })}</span><strong
            >{datePart(next.session.start, { day: 'numeric' })}</strong
          ><span>{datePart(next.session.start, { month: 'short' })}</span>
        </div>
        <div>
          <span class="badge published">{next.session.start <= now ? 'IN PROGRESS' : 'SELECTED'}</span>
          <h2>{next.raid.name}</h2>
        </div>
      </div>
      <p class="raid-time">{compactSessionLabel(next.session, viewerZone)}</p>
      <RaidResponse item={next} {memberId} />
      {#if online}<RaidBriefing item={next} {now} />{/if}
      <div class="assignment">
        <span class="eyebrow">YOUR CHARACTER</span>
        <p>
          <strong>{next.character?.name ?? 'Your assigned character'}</strong>
          <span class="badge">{next.assignment.role}</span>
        </p>
        {#if next.character}<small
            >{next.character.spec} {next.character.class} · {next.character.realm}</small
          >{/if}
      </div>
      {#if online}<RaidChangeLog item={next} {memberId} />{/if}
      <button class="text-button" onclick={() => openRaid(next)}
        >View published roster <span aria-hidden="true">→</span></button
      >
      {#if online}
        <button class="text-button" onclick={showCalendar}
          >Follow your raids in your calendar <span aria-hidden="true">↓</span></button
        >
      {/if}
    {:else}
      <div class="empty-raid-mark"><Icon name="shield" size={36} /></div>
      <span class="eyebrow">UP NEXT</span>
      <h2>No upcoming assignment yet</h2>
      <span class="badge">{weekStatus(app.data, thisWeek, memberId)}</span>
      <p>When an officer publishes a roster with you on it, your raid and character will appear here.</p>
      <p class="empty-guidance">
        {checkin.checkedIn
          ? 'Your availability is in. You’re ready for the next roster.'
          : 'Start with your availability so your officers can plan around you.'}
      </p>
      <button class="primary" onclick={checkIn}
        >{checkin.checkedIn ? 'Review my times' : 'Set my availability'}
        <Icon name="arrow" size={17} /></button
      >
    {/if}
  </section>

  <section
    class="panel home-checkin jump-target"
    id="home-availability"
    tabindex="-1"
    aria-label="This week’s check-in"
  >
    <div class="panel-kicker">
      <span class="eyebrow">YOUR CHECK-IN</span><Icon name="calendar" size={20} />
    </div>
    <h2>This week’s availability</h2>
    <span class="badge" class:success={checkin.checkedIn}
      >{availabilitySource(app.data, thisWeek, memberId)}</span
    >
    <p>
      {!checkin.checkedIn
        ? 'Your officers are waiting for your times.'
        : checkin.paused
          ? 'Your usual schedule is paused, so you count as away this week.'
          : checkin.ranges.length
            ? 'Your times are ready for planning. Review them if anything has changed.'
            : 'You have let officers know you can’t make it this week.'}
    </p>
    {#if reviewDue}
      <div
        class="schedule-review"
        id={SCHEDULE_REVIEW_ANCHOR}
        role="group"
        aria-label="Review your usual schedule"
      >
        <p>
          Is your usual schedule still right? You last confirmed it {formatMonthDay(
            templateConfirmedOn(template),
          )}.
        </p>
        <div class="buttons">
          <button class="primary" onclick={confirmSchedule}>Still right</button>
          <button onclick={checkIn}>Review it</button>
        </div>
      </div>
    {/if}
    <RaidQuickAnswer {memberId} weekIso={thisWeek} {now} />
    <button class="checkin-action" class:primary={!checkin.checkedIn} onclick={checkIn}
      >Update my availability <Icon name="arrow" size={17} /></button
    >
    <InlineSaveStatus />
  </section>
</div>

<OnboardingChecklist {memberId} weekIso={thisWeek} />

{#if later.length}
  <section
    class="upcoming jump-target"
    id="home-upcoming"
    tabindex="-1"
    aria-label="Upcoming published raids"
  >
    <div class="section-head">
      <div>
        <span class="eyebrow gold">ON THE HORIZON</span>
        <h2>Upcoming published raids</h2>
      </div>
      <span class="badge published">{later.length} upcoming</span>
    </div>
    <ul>
      {#each later as item (`${item.weekIso}:${item.raidId}`)}
        <li id={raidAnchor(item.weekIso, item.raidId)}>
          <div class="upcoming-date">
            <strong>{datePart(item.session.start, { month: 'short', day: 'numeric' })}</strong><small
              >{datePart(item.session.start, { weekday: 'long' })}</small
            >
          </div>
          <div>
            <h3>{item.raid.name}</h3>
            <p>{compactSessionLabel(item.session, viewerZone)}</p>
            <p>
              {item.assignment
                ? `${item.character?.name ?? 'Assigned character'} · ${item.assignment.role}`
                : 'You are not on this roster'}
            </p>
          </div>
          {#if item.assignment}<RaidResponse {item} {memberId} />
          {:else if standbyOnline() && remote.memberId === memberId}<StandbyOffer
              {item}
              {memberId}
              {now}
            />{/if}
          <button aria-label={`View roster for ${item.raid.name}`} onclick={() => openRaid(item)}
            >View roster</button
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}

<div class="spaced-top jump-target" id="home-month" tabindex="-1"><RaidMonth /></div>

{#if online}
  <section
    class="spaced-top home-settings jump-target"
    id="home-settings"
    tabindex="-1"
    aria-labelledby="home-settings-heading"
  >
    <h2 id="home-settings-heading">Your history and settings</h2>
    <RaidRecord {memberId} {thisWeek} {now} />
    <!-- Still reachable before a first roster, e.g. to turn off an old link. -->
    <details class="panel calendar-link" bind:this={calendarPanel}>
      <summary>Calendar link</summary>
      {#if !assigned.length}
        <p class="note">
          Once an officer puts you on a roster, your raids can follow you into your calendar app.
        </p>
      {/if}
      <CalendarSubscription />
    </details>
    <ReminderPreferences discordLinked={Boolean(member?.discordId)} />
  </section>
{:else}
  <div class="spaced-top"><RaidRecord {memberId} {thisWeek} {now} /></div>
{/if}

<style>
  .home-jump {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 4px;
    margin: 0 0 24px;
    padding: 8px 0;
    overflow-x: auto;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }
  .home-jump button {
    flex: 0 0 auto;
    white-space: nowrap;
    padding: 6px 14px;
    border-radius: 6px;
    background: transparent;
    border-color: transparent;
    font-size: 13px;
  }
  .home-jump .text-button {
    margin-left: auto;
  }
  /* On phones officers reach the dashboard from More; the bar keeps to this page. */
  @media (max-width: 760px) {
    .home-jump .text-button {
      display: none;
    }
  }
  .jump-target {
    scroll-margin-top: 72px;
  }
  .jump-target:focus {
    outline: none;
  }
  .home-settings {
    display: grid;
    gap: 12px;
  }
  .home-settings h2 {
    margin: 0;
  }
  .calendar-link summary {
    cursor: pointer;
  }
  .schedule-review {
    margin: 0.75rem 0;
    padding: 0.75rem;
    border-left: 2px solid var(--gold);
    background: #ffffff05;
  }
  .schedule-review p {
    margin: 0 0 0.5rem;
  }
  .home-priorities {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
    gap: 20px;
    align-items: start;
  }
  .next-raid {
    border: 1px solid #706044;
    background: linear-gradient(120deg, #302b22 0%, var(--panel) 65%);
    padding: 28px;
    position: relative;
    overflow: hidden;
  }
  .panel-kicker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--gold);
    margin-bottom: 20px;
  }
  .empty-raid-mark {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    border: 1px solid #706044;
    border-radius: 16px;
    color: var(--gold);
    margin-bottom: 24px;
    background: #dbb5740a;
  }
  .home-checkin {
    background: linear-gradient(150deg, #203029, var(--panel) 65%);
    border-color: #3e5549;
  }
  .home-checkin .panel-kicker {
    color: var(--green);
  }
  .checkin-action {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .next-raid h2 {
    font-size: 26px;
    margin-top: 12px;
  }
  .next-raid-heading {
    display: flex;
    gap: 22px;
    align-items: center;
  }
  .raid-date {
    flex: 0 0 72px;
    display: grid;
    text-align: center;
    padding: 10px;
    border: 1px solid #786342;
    background: #dbb57410;
    border-radius: 12px;
    color: var(--gold);
  }
  .raid-date span {
    font-size: 12px;
    text-transform: uppercase;
  }
  .raid-date strong {
    font-size: 32px;
    line-height: 1.2;
  }
  .assignment {
    padding: 18px 0;
    border-block: 1px solid var(--line);
  }
  .assignment p {
    margin: 8px 0 4px;
    color: var(--text);
  }
  .assignment strong {
    margin-right: 10px;
  }
  .home-checkin h2 {
    margin: 12px 0 16px;
  }
  .empty-guidance {
    border-top: 1px solid var(--line);
    padding-top: 20px;
  }
  .raid-time {
    font-size: 15px;
    color: var(--text);
  }
  .upcoming {
    margin-top: 1.5rem;
    padding: 24px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
  }
  ul {
    display: grid;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    padding: 18px 0;
    border-bottom: 1px solid var(--line);
  }
  li > div {
    flex: 1 1 18rem;
  }
  h3 {
    margin-top: 0;
  }
  li .upcoming-date {
    flex: 0 0 95px;
    border-left: 2px solid var(--gold);
    padding-left: 14px;
  }
  li p {
    margin: 4px 0;
    font-size: 13px;
  }
  @media (max-width: 1000px) {
    .home-priorities {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 600px) {
    .next-raid {
      padding: 20px;
    }
    .next-raid h2 {
      font-size: 22px;
    }
    .next-raid-heading {
      gap: 16px;
    }
  }
</style>
