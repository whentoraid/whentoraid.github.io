<script>
  import { untrack } from 'svelte'
  import { app } from '../lib/app.svelte.js'
  import { discordChannel } from '../lib/discord-channel.svelte.js'
  import { listDiscordRoles } from '../lib/discord-connect.js'
  import { saveSettings } from '../lib/model.js'
  import { supabase } from '../lib/remote/client.js'
  import { canManage, flushOnlineChanges, remote } from '../lib/remote/sync.svelte.js'
  import { showToast } from '../lib/toast.svelte.js'

  let { settingsDirty = false, onsaved = () => {} } = $props()
  let roles = $state([])
  let error = $state('')
  let loading = $state(false)
  let saving = $state(false)
  let loadedFor = $state('')
  const saved = $derived(app.data.guild.officerRoleIds.split(/[ ,]+/).filter(Boolean))
  let selected = $derived(saved)
  const changed = $derived(selected.join(',') !== saved.join(','))
  const unknown = $derived(saved.filter((id) => !roles.some((role) => role.id === id)))

  async function loadRoles(force = false) {
    const guildId = remote.guildId
    const serverId = discordChannel.serverId
    if (!guildId || !serverId || !canManage()) return
    const key = `${guildId}/${serverId}`
    if (!force && loadedFor === key) return
    loadedFor = key
    loading = true
    error = ''
    try {
      const listed = await listDiscordRoles(supabase, guildId)
      if (remote.guildId === guildId && discordChannel.serverId === serverId) roles = listed
    } catch (failure) {
      if (remote.guildId === guildId && discordChannel.serverId === serverId) error = failure.message
    } finally {
      loading = false
    }
  }

  $effect(() => {
    if (remote.guildId && discordChannel.serverId && canManage()) untrack(() => void loadRoles())
  })

  function toggle(id) {
    selected = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]
  }

  async function save() {
    if (settingsDirty || saving) return
    const result = saveSettings(app.data, { officerRoleIds: selected.join(',') })
    if (result.error) {
      error = result.error
      return
    }
    saving = true
    error = ''
    app.data = result.state
    onsaved()
    try {
      await flushOnlineChanges()
      showToast('Officer roles saved. People with these Discord roles receive planner access when they join.')
    } catch (failure) {
      error = failure.message
    } finally {
      saving = false
    }
  }
</script>

{#if remote.guildId && discordChannel.serverId && canManage()}
  <section class="officer-roles" aria-label="Officer access">
    <h3>Officer access</h3>
    <p>
      Choose the Discord roles that can plan raids. Everyone else in this server joins as a player. Your own
      officer access stays in place.
    </p>
    {#if loading}
      <p class="note" role="status">Loading Discord roles…</p>
    {:else if error && !roles.length}
      <p class="warning" role="alert">{error}</p>
      <button type="button" onclick={() => loadRoles(true)}>Retry roles</button>
    {:else}
      <div class="role-list" role="group" aria-label="Discord officer roles">
        {#each roles as role (role.id)}
          <label class="checkbox-row">
            <input type="checkbox" checked={selected.includes(role.id)} onchange={() => toggle(role.id)} />
            {role.name}
          </label>
        {/each}
      </div>
      {#if !roles.length}<p class="note">This server has no assignable roles yet.</p>{/if}
      {#if unknown.length}<p class="note">
          {unknown.length} saved role ID(s) are no longer in this server. Saving this selection removes them.
        </p>{/if}
      {#if settingsDirty}<p class="note">
          Save or discard your changes on Raid rules before changing officer access.
        </p>{/if}
      {#if error}<p class="warning" role="alert">{error}</p>{/if}
      <div class="buttons">
        <button type="button" disabled={!changed || settingsDirty || saving} onclick={save}
          >Save officer roles</button
        >
        <button type="button" disabled={loading || saving} onclick={() => loadRoles(true)}
          >Refresh roles</button
        >
      </div>
    {/if}
  </section>
{/if}

<style>
  .officer-roles {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--line);
  }
  .role-list {
    display: grid;
    gap: 0.5rem;
    margin: 1rem 0;
  }
</style>
