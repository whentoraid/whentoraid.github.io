<script>
  import { app } from '../lib/app.svelte.js'
  import { SPEC_ROLES } from '../lib/constants.js'
  import { displayZone } from '../lib/display.svelte.js'
  import { charactersOf, getCheckin, restoreCheckin } from '../lib/model.js'
  import { compactSessionLabel, exactSessionLabel, personalRaids } from '../lib/personal-raids.js'
  import { announcedRaids, answerRaid, raidAnswer } from '../lib/raid-answers.js'
  import { listRaidSignups, saveRaidAnswer, undoRaidAnswer } from '../lib/raid-services.js'
  import { supabase } from '../lib/remote/client.js'
  import { flushOnlineChanges, refreshOnlineGuild, remote } from '../lib/remote/sync.svelte.js'
  import { offerUndo, showToast } from '../lib/toast.svelte.js'
  import Icon from './Icon.svelte'
  import StandbyOffer from './StandbyOffer.svelte'
  import { standbyOnline } from '../lib/standby.svelte.js'

  let { memberId, weekIso, now = Date.now(), excludeRaidIds = [] } = $props()
  const ANSWERS = [
    { id: 'in', status: 'signed', label: 'I’m in', saved: 'Signed up · awaiting roster' },
    { id: 'late', status: 'late', label: 'Late', saved: 'Signed up · arriving late' },
    { id: 'tentative', status: 'tentative', label: 'Tentative', saved: 'Tentative' },
    { id: 'out', status: 'absent', label: 'Can’t make it', saved: 'Not attending' },
  ]
  const raids = $derived(
    announcedRaids(app.data, weekIso).filter(
      (item) => item.start > now && !excludeRaidIds.includes(item.raid.id),
    ),
  )
  const characters = $derived(charactersOf(app.data, memberId))
  const published = $derived(
    personalRaids(app.data, memberId, now).filter((item) => item.weekIso === weekIso),
  )
  const zone = $derived(displayZone(app.data.guild))
  const online = $derived(Boolean(remote.guildId && supabase))
  const scope = $derived(JSON.stringify([remote.guildId, weekIso, memberId]))
  const checkins = $derived(app.data.weeks[weekIso]?.checkins)
  let loaded = $state({ scope: null, rows: [], error: '' })
  let choices = $state({})
  let pending = $state({})
  let failures = $state({})
  let saved = $state({})
  let refresh = $state(0)
  let readVersion = 0

  $effect(() => {
    const key = scope
    void checkins
    void refresh
    if (!online) return
    const version = ++readVersion
    const member = memberId
    let active = true
    listRaidSignups(supabase, remote.guildId, weekIso)
      .then((rows) => {
        if (active && version === readVersion)
          loaded = { scope: key, rows: (rows ?? []).filter((row) => row.member_id === member), error: '' }
      })
      .catch((error) => {
        if (active && version === readVersion) loaded = { scope: key, rows: [], error: error.message }
      })
    return () => {
      active = false
    }
  })

  const keyFor = (id) => `${scope}:${id}`
  function current(item) {
    if (online) return loaded.scope === scope ? loaded.rows.find((row) => row.raid_id === item.raid.id) : null
    const preference = getCheckin(app.data, weekIso, memberId).raids?.[item.raid.id]
    const answer = raidAnswer(app.data, weekIso, memberId, item)
    return answer
      ? {
          status:
            answer === 'in' && preference?.signupStatus === 'late'
              ? 'late'
              : ANSWERS.find((choice) => choice.id === answer)?.status,
          character_id: preference?.signedAs?.characterId,
          spec: preference?.signedAs?.spec,
          role: preference?.signedAs?.role,
        }
      : null
  }
  function characterFor(item) {
    const id = choices[keyFor(item.raid.id)]?.characterId ?? current(item)?.character_id
    return characters.find((c) => c.id === id) ?? characters.find((c) => c.main) ?? characters[0]
  }
  function specOptions(character) {
    return Object.entries(SPEC_ROLES[character?.class] ?? {}).flatMap(([spec, role]) =>
      (role ? [role] : ['Tank', 'DPS']).map((role) => ({ spec, role, value: `${spec}|${role}` })),
    )
  }
  function specFor(item) {
    const character = characterFor(item)
    const choice = choices[keyFor(item.raid.id)]
    if (choice?.spec) return choice.spec
    const row = current(item)
    return row?.character_id === character?.id && row?.spec
      ? `${row.spec}|${row.role}`
      : `${character?.spec}|${character?.role}`
  }
  function setChoice(item, patch) {
    const key = keyFor(item.raid.id)
    choices = { ...choices, [key]: { ...choices[key], ...patch } }
  }
  function updateRow(key, row, raidId) {
    if (key !== scope) return
    readVersion++
    loaded = {
      scope: key,
      error: '',
      rows: [
        ...(loaded.scope === key ? loaded.rows.filter((r) => r.raid_id !== raidId) : []),
        ...(row ? [row] : []),
      ],
    }
  }
  async function undo(guildId, key, item, undoId) {
    if (guildId !== remote.guildId || key !== scope)
      return showToast('Open the original guild and raid to change this answer.')
    try {
      await flushOnlineChanges()
      if (guildId !== remote.guildId || key !== scope) return
      const result = await undoRaidAnswer(supabase, undoId)
      updateRow(key, result.signup, item.raid.id)
      refreshOnlineGuild()
      showToast('Answer undone.')
    } catch (error) {
      showToast(error.message)
    }
  }
  async function send(item, choice, retry = null) {
    const key = keyFor(item.raid.id)
    if (pending[key] || item.start <= now) return
    const character = characterFor(item)
    const [spec, role] = specFor(item).split('|')
    if (choice.id !== 'out' && !character) return showToast('Add a character before signing up.')
    if (!online) {
      const previous = app.data
      let next = answerRaid(
        app.data,
        weekIso,
        memberId,
        item,
        choice.id === 'late' ? 'in' : choice.id,
        character?.id,
      )
      const checkin = getCheckin(next, weekIso, memberId)
      next = restoreCheckin(next, weekIso, memberId, {
        ...checkin,
        raids: {
          ...checkin.raids,
          [item.raid.id]: {
            ...checkin.raids[item.raid.id],
            signupStatus: choice.status,
            ...(character && choice.id !== 'out'
              ? { signedAs: { characterId: character.id, spec, role } }
              : {}),
          },
        },
      })
      app.data = next
      offerUndo(`${choice.saved} for ${item.raid.name}.`, previous)
      return
    }
    const guildId = remote.guildId
    const originalScope = scope
    const args = retry ?? {
      weekIso,
      memberId,
      raidId: item.raid.id,
      status: choice.status,
      characterId: choice.id === 'out' ? null : character?.id,
      spec: choice.id === 'out' ? null : spec,
      role: choice.id === 'out' ? null : role,
      requestId: crypto.randomUUID(),
    }
    pending = { ...pending, [key]: true }
    failures = { ...failures, [key]: null }
    try {
      await flushOnlineChanges()
      if (guildId !== remote.guildId || originalScope !== scope) return
      const result = await saveRaidAnswer(supabase, guildId, args)
      if (guildId !== remote.guildId || originalScope !== scope) return
      updateRow(originalScope, result.signup, item.raid.id)
      choices = { ...choices, [key]: undefined }
      saved = { ...saved, [key]: true }
      refreshOnlineGuild()
      showToast(`Answer saved for ${item.raid.name}.`, {
        label: 'Undo',
        run: () => void undo(guildId, originalScope, item, result.undoId),
      })
    } catch (error) {
      if (originalScope === scope) failures = { ...failures, [key]: { message: error.message, args, choice } }
    } finally {
      pending = { ...pending, [key]: false }
    }
  }
</script>

{#if raids.length}
  <section class="quick-answers" aria-label="Answer this week’s raids">
    <h2>This week’s raids</h2>
    {#if online && loaded.scope !== scope}<p role="status">Loading your answers…</p>{/if}
    {#if online && loaded.scope === scope && loaded.error}
      <p role="alert">Your answers could not be loaded: {loaded.error}</p>
      <button onclick={() => refresh++}>Retry answers</button>
    {/if}
    {#each raids as item (item.raid.id)}
      {@const key = keyFor(item.raid.id)}
      {@const row = current(item)}
      {@const selected = ANSWERS.find((choice) => choice.status === row?.status)}
      {@const character = characterFor(item)}
      {@const roster = published.find((entry) => entry.raidId === item.raid.id)}
      <article class="quick-raid">
        <h3>{item.raid.name}</h3>
        <p class="raid-time" title={exactSessionLabel(item, zone)}>{compactSessionLabel(item, zone)}</p>
        <p class="answer-state" role="status">
          {#if selected}<Icon name="check" size={16} /> Your answer: {selected.saved}
          {:else if online && loaded.scope !== scope}Checking your answer…
          {:else if online && loaded.error}Answer unavailable
          {:else}Choose your answer{/if}
        </p>
        {#if row?.character_id}
          <small
            >Signed up as {characters.find((c) => c.id === row.character_id)?.name ?? 'your character'} · {row.spec ??
              character?.spec} · {row.role ?? character?.role}</small
          >
        {/if}
        {#if characters.length}
          <div class="signup-choices">
            <label class="field"
              >Character<select
                value={character?.id}
                disabled={pending[key]}
                onchange={(event) => setChoice(item, { characterId: event.currentTarget.value, spec: null })}
              >
                {#each characters as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
              </select></label
            >
            <label class="field"
              >Spec for this raid<select
                value={specFor(item)}
                disabled={pending[key]}
                onchange={(event) => setChoice(item, { spec: event.currentTarget.value })}
              >
                {#each specOptions(character) as option (option.value)}<option value={option.value}
                    >{option.spec} · {option.role}</option
                  >{/each}
              </select></label
            >
          </div>
        {:else}<button onclick={() => (app.view = 'characters')}>Add a character</button>{/if}
        <div class="answer-buttons" role="group" aria-label={`Your answer for ${item.raid.name}`}>
          {#each ANSWERS as choice (choice.id)}
            <button
              aria-pressed={row?.status === choice.status}
              disabled={pending[key] ||
                (online && loaded.scope !== scope) ||
                (choice.id !== 'out' && !characters.length)}
              onclick={() => send(item, choice)}
            >
              {#if row?.status === choice.status}<Icon name="check" size={15} />{/if}{choice.label}
            </button>
          {/each}
        </div>
        {#if choices[key] && selected && selected.id !== 'out'}
          <button class="save-choices" disabled={pending[key]} onclick={() => send(item, selected)}
            >Save character & spec</button
          >
        {/if}
        {#if pending[key]}<p role="status">Saving answer…</p>
        {:else if failures[key]}<div role="alert" class="save-error">
            <p>We couldn’t confirm this save: {failures[key].message}</p>
            <button onclick={() => send(item, failures[key].choice, failures[key].args)}>Retry save</button>
          </div>
        {:else if saved[key]}<small role="status">Saved · shared with your guild</small>{/if}
        {#if roster}
          {#if standbyOnline() && remote.memberId === memberId}<StandbyOffer
              item={roster}
              {memberId}
              {now}
            />{/if}
          <button
            class="text-button"
            onclick={() => {
              app.data = { ...app.data, currentWeek: weekIso, currentRaidId: item.raid.id }
              app.plannerIntent = 'published'
              app.view = 'planner'
            }}>View published roster</button
          >
        {/if}
      </article>
    {/each}
    <p class="note">Signups stay open until each raid starts. Your officers choose and publish the roster.</p>
  </section>
{/if}

<style>
  h2 {
    font-size: 19px;
    margin: 0 0 12px;
  }
  h3 {
    font-size: 16px;
  }
  .quick-raid {
    padding: 16px 0;
    border-top: 1px solid var(--line);
  }
  .raid-time {
    margin: 4px 0 10px;
    color: var(--text);
    font-size: 14px;
  }
  .answer-state {
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin: 8px 0;
    color: var(--green);
    font-size: 14px;
  }
  .signup-choices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 12px 0;
  }
  select {
    width: 100%;
  }
  .answer-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .answer-buttons button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .answer-buttons button[aria-pressed='true'] {
    border-color: var(--green);
    background: #20372a;
    color: #c6efd4;
    font-weight: 700;
  }
  .save-choices {
    margin-top: 10px;
  }
  .save-error {
    border-left: 2px solid var(--red);
    padding-left: 10px;
  }
  @media (max-width: 600px) {
    .answer-buttons {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .signup-choices {
      grid-template-columns: 1fr;
    }
  }
</style>
