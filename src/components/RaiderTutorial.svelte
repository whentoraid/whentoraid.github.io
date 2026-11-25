<script>
  import { tick, untrack } from 'svelte'
  import { app } from '../lib/app.svelte.js'
  import { checkinsClosed } from '../lib/checkins.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { readCharacterFields } from '../lib/forms.js'
  import {
    charactersOf,
    getCheckin,
    markUnavailable,
    saveCharacter,
    setAvailabilityKind,
  } from '../lib/model.js'
  import { hasGivenAvailability } from '../lib/personal-raids.js'
  import { announcedRaids } from '../lib/raid-answers.js'
  import { readTutorial, saveTutorial, tutorialWeek } from '../lib/raider-tutorial.js'
  import { flushOnlineChanges, remote } from '../lib/remote/sync.svelte.js'
  import { localSave } from '../lib/save-status.svelte.js'
  import { addDays, formatWeekRange } from '../lib/time.js'
  import AvailabilityRanges from './AvailabilityRanges.svelte'
  import CharacterFields from './CharacterFields.svelte'
  import InlineSaveStatus from './InlineSaveStatus.svelte'
  import Modal from './Modal.svelte'
  import RaidQuickAnswer from './RaidQuickAnswer.svelte'

  // App keys this component by guild + member so an open tutorial cannot cross accounts.
  let { scope } = $props()
  const previous = untrack(() => readTutorial(scope))
  let open = $state(previous.status === 'active')
  let step = $state(previous.step)
  let now = $state(Date.now())
  let weekIso = $state(untrack(() => tutorialWeek(app.data)))
  let busy = $state(false)
  let error = $state('')
  let answeredHere = $state(false)
  let practiced = $state(false)
  let heading
  const memberId = $derived(app.data.currentMemberId)
  const characters = $derived(charactersOf(app.data, memberId))
  const main = $derived(characters.find((character) => character.main) ?? characters[0])
  const answered = $derived(hasGivenAvailability(app.data, weekIso, memberId) || answeredHere)
  const checkin = $derived(getCheckin(app.data, weekIso, memberId))
  const raids = $derived(announcedRaids(app.data, weekIso).filter((item) => item.start > now))
  const closed = $derived(checkinsClosed(app.data, weekIso, now))
  const zone = $derived(displayZone(app.data.guild).replaceAll('_', ' '))
  const titles = ['Add your raiding character', 'Give your first answer', 'Try confirming your spot']

  $effect(() => {
    if (!open) return
    const timer = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(timer)
  })
  $effect(() => {
    if (!app.tutorialRequested) return
    app.tutorialRequested = false
    const saved = readTutorial(scope)
    step = saved.status === 'complete' ? 0 : saved.step
    weekIso = tutorialWeek(app.data)
    error = ''
    practiced = false
    answeredHere = false
    open = true
  })
  $effect(() => {
    if (!open) return
    // A failed save, retired character or different device must not skip an unfinished step.
    if (step > 0 && !characters.length) step = 0
    else if (step > 1 && !answered) step = 1
    saveTutorial(scope, 'active', step)
  })
  $effect(() => {
    if (!open) return
    void step
    void tick().then(() => heading?.focus())
  })

  function pause() {
    if (!open) return
    saveTutorial(scope, 'paused', step)
    open = false
  }

  async function next() {
    if (busy) return
    busy = true
    error = ''
    try {
      await flushOnlineChanges()
      if (remote.guildId ? remote.status !== 'saved' : localSave.status === 'error')
        throw new Error('Your changes have not saved yet. Keep this tutorial open and try again.')
      if (!open) return
      if (step === 0 && characters.length) step = 1
      else if (step === 1 && answered) step = 2
    } catch (failure) {
      error = failure.message
    } finally {
      busy = false
    }
  }

  function addCharacter(event) {
    event.preventDefault()
    const result = saveCharacter(app.data, memberId, readCharacterFields(new FormData(event.currentTarget)))
    if (result.error) {
      error = result.error
      return
    }
    app.data = result.state
    void next()
  }

  function paint(interval, available) {
    if (checkinsClosed(app.data, weekIso)) return
    app.data = setAvailabilityKind(app.data, weekIso, memberId, interval, 'firm', available)
  }

  function unavailable() {
    if (checkinsClosed(app.data, weekIso)) return
    app.data = markUnavailable(app.data, weekIso, memberId)
  }

  function finish() {
    saveTutorial(scope, 'complete', 2)
    open = false
    app.view = 'home'
  }
</script>

<Modal open={open && !remote.hasUnsavedDraft} onclose={pause} label="Raider tutorial">
  <div class="tutorial">
    <p class="eyebrow gold">WELCOME TO {app.data.guild.name}</p>
    <ol class="tutorial-progress" aria-label="Tutorial progress">
      {#each ['Character', 'Availability', 'Confirmation'] as label, index (label)}
        <li
          class:current={step === index}
          class:done={step > index}
          aria-current={step === index ? 'step' : undefined}
        >
          <span aria-hidden="true">{step > index ? '✓' : index + 1}</span>{label}
        </li>
      {/each}
    </ol>
    <p class="note">Step {step + 1} of 3 · Learn by doing</p>
    <h2 bind:this={heading} tabindex="-1">{titles[step]}</h2>

    {#if step === 0}
      {#if main}
        <p>Your character is already here. You can keep going without adding another.</p>
        <div class="tutorial-card">
          <strong>{main.name}</strong>
          <p>{main.spec} {main.class} · {main.role}</p>
          <small>{main.realm}</small>
        </div>
        <button class="primary" disabled={busy} onclick={next}
          >{busy ? 'Checking save…' : 'Continue to my answer'}</button
        >
      {:else}
        <p>
          Add the character you want to bring. This saves to {remote.guildId
            ? 'your guild profile'
            : 'this browser'}; alts can wait.
        </p>
        <form onsubmit={addCharacter}>
          <fieldset class="plain" disabled={busy}>
            <div class="tutorial-fields"><CharacterFields /></div>
            <p class="note">Choosing a specialization suggests your raid role.</p>
            <button class="primary">{busy ? 'Saving…' : 'Save my character & continue'}</button>
          </fieldset>
        </form>
      {/if}
    {:else if step === 1}
      <p>
        Tell your officers when you can play. Your answer here is real and saves to {remote.guildId
          ? 'your guild'
          : 'this browser'}.
      </p>
      <p class="tutorial-time"><strong>{formatWeekRange(weekIso)}</strong> · Times in {zone}</p>
      {#if answered}
        <div class="tutorial-card" role="status">
          <strong>You’ve given availability.</strong>
          <p>Your first answer is ready. Continue to learn how roster confirmation works.</p>
        </div>
      {/if}
      {#if raids.length}
        <p>Choose an answer for a raid below. “Can’t make it” counts too. No weekly grid required.</p>
        <RaidQuickAnswer
          {memberId}
          {weekIso}
          {now}
          heading="Raids to answer"
          onanswered={() => (answeredHere = true)}
        />
      {:else if !answered}
        {#if closed}
          <p>This week’s availability has closed. You can start with next week.</p>
          <button onclick={() => (weekIso = addDays(weekIso, 7))}>Answer next week</button>
        {:else}
          <p>
            No raid time has been announced for this week. Open a day and add a time you can play, or let your
            officers know you’re away.
          </p>
          <AvailabilityRanges {weekIso} grid={app.data.guild} ranges={checkin.ranges} onpaint={paint} />
          <button class="away-answer" onclick={unavailable}>I’m unavailable for this week</button>
        {/if}
      {/if}
      <InlineSaveStatus />
      <button class="primary" disabled={!answered || busy} onclick={next}
        >{busy ? 'Checking save…' : 'Continue to confirmation'}</button
      >
    {:else}
      <p>
        Signing up tells officers you’re available. Once they publish a roster with you on it, confirm your
        place in <strong>Raids</strong>.
      </p>
      <section class="tutorial-card practice" aria-label="Practice confirmation">
        <span class="badge">PRACTICE ONLY</span>
        <h3>Your example raid spot</h3>
        <p>{main?.name} · {main?.role}</p>
        <p class="note">
          Try the button below. This example does not sign you up or send a confirmation to your guild.
        </p>
        {#if practiced}
          <p class="practice-success" role="status">
            ✓ That’s it! On a real roster, your officers would see that you confirmed.
          </p>
        {:else}
          <button class="primary" onclick={() => (practiced = true)}>I’ll be there</button>
        {/if}
      </section>
      <p>If plans change, open that raid and use <strong>I can’t make it</strong> to tell your officers.</p>
      <button class="primary" onclick={finish}>Finish tutorial & view Raids</button>
    {/if}

    {#if error}<p class="warning" role="alert">{error}</p>{/if}
    <div class="tutorial-footer">
      {#if step > 0}<button
          disabled={busy}
          onclick={() => {
            step--
            error = ''
          }}>Back</button
        >{/if}
      <button onclick={pause}>Finish later</button>
      <small>Reopen from Raider tutorial in the menu. Saved answers are kept.</small>
    </div>
  </div>
</Modal>

<style>
  .tutorial {
    clear: both;
  }
  .tutorial-progress {
    display: flex;
    gap: 12px;
    list-style: none;
    padding: 0;
    margin: 20px 0;
  }
  .tutorial-progress li {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    color: var(--muted);
    font-size: 12px;
  }
  .tutorial-progress span {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--line);
    border-radius: 50%;
  }
  .tutorial-progress .current {
    color: var(--gold);
  }
  .current span {
    border-color: var(--gold);
    background: #dbb57412;
  }
  .tutorial-progress .done,
  .practice-success {
    color: var(--green);
  }
  h2:focus {
    outline: none;
  }
  .tutorial-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .tutorial-fields :global(input),
  .tutorial-fields :global(select) {
    width: 100%;
    min-width: 0;
  }
  .tutorial-card {
    padding: 16px;
    margin: 16px 0;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
  }
  .tutorial-card p:last-child {
    margin-bottom: 0;
  }
  .practice {
    border-color: var(--gold);
  }
  .practice h3 {
    margin-top: 12px;
  }
  .tutorial-time {
    padding-block: 12px;
    border-block: 1px solid var(--line);
    font-size: 13px;
  }
  .away-answer {
    margin-top: 16px;
  }
  .tutorial-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    border-top: 1px solid var(--line);
    margin-top: 24px;
    padding-top: 16px;
  }
  .tutorial-footer small {
    flex-basis: 100%;
  }
  @media (max-width: 600px) {
    .tutorial-fields {
      grid-template-columns: 1fr;
    }
  }
</style>
