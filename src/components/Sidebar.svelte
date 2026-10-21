<script>
  import { app } from '../lib/app.svelte.js'
  import { requestLeave } from '../lib/leave-guard.js'
  import { setCurrentMember } from '../lib/members.js'
  import { memberById } from '../lib/model.js'
  import { canManage, remote } from '../lib/remote/sync.svelte.js'
  import { EDIT_AS_OTHER_PLAYERS } from '../lib/features.js'
  import Icon from './Icon.svelte'
  import { localSave } from '../lib/save-status.svelte.js'

  let { onfeedback = () => {} } = $props()

  const NAV_ITEMS = [
    { view: 'home', icon: 'home', label: 'My raids' },
    { view: 'availability', icon: 'calendar', label: 'My availability' },
    { view: 'characters', icon: 'character', label: 'My characters' },
    { view: 'officer', icon: 'dashboard', label: 'Officer dashboard' },
    { view: 'planner', icon: 'planner', label: 'Raid planner' },
    { view: 'members', icon: 'members', label: 'Guild members' },
    { view: 'settings', icon: 'settings', label: 'Guild settings' },
  ]
  /**
   * Players keep to their own raid week; each of their raids links to its published roster. Guild tools
   * are officer work. The server still enforces this.
   */
  const guildItems = $derived(canManage() ? NAV_ITEMS.slice(3) : [])
  const GUILD_VIEWS = NAV_ITEMS.slice(3).map((item) => item.view)
  let moreOpen = $state(false)
  let moreButton

  function navigate(view) {
    requestLeave(() => {
      app.view = view
      moreOpen = false
    })
  }

  function closeMenu(event) {
    if (event.key === 'Escape' && moreOpen) {
      moreOpen = false
      moreButton?.focus()
    }
  }

  const me = $derived(memberById(app.data, app.data.currentMemberId))
  const initials = $derived((me?.name ?? '?').slice(0, 2).toUpperCase())

  function goHome(event) {
    event.preventDefault()
    navigate('home')
  }

  function switchMember(event) {
    app.data = setCurrentMember(app.data, event.currentTarget.value)
  }
</script>

<svelte:window onkeydown={closeMenu} />

<aside class="sidebar" class:more-open={moreOpen}>
  <a class="brand" href="#/home" onclick={goHome}>
    <span class="crest">W</span>
    <span>WHEN<span class="gold">TO</span>RAID<small>THE GUILD WAR ROOM</small></span>
  </a>
  <div class="guild">
    <span class="guild-icon">✦</span>
    <div>{app.data.guild.name}<small>WoW: Forever · {app.data.members.length} players</small></div>
  </div>
  <nav class="personal-nav" aria-label="Your raid week">
    <p class="nav-label">YOUR RAID WEEK</p>
    {#each NAV_ITEMS.slice(0, 3) as item (item.view)}
      <button
        class:active={app.view === item.view}
        aria-current={app.view === item.view ? 'page' : undefined}
        onclick={() => navigate(item.view)}
      >
        <Icon name={item.icon} /> <span>{item.label}</span>
      </button>
    {/each}
    <button
      class="mobile-more"
      class:active={moreOpen || (guildItems.length > 0 && GUILD_VIEWS.includes(app.view))}
      aria-expanded={moreOpen}
      aria-controls="guild-menu"
      onclick={() => (moreOpen = !moreOpen)}
      bind:this={moreButton}><Icon name="more" /><span>More</span></button
    >
  </nav>
  <div class="guild-menu" id="guild-menu">
    <p class="mobile-guild-name">{app.data.guild.name}</p>
    {#if guildItems.length}
      <nav aria-label="Guild tools">
        <p class="nav-label">GUILD TOOLS</p>
        {#each guildItems as item (item.view)}
          <button
            class:active={app.view === item.view}
            aria-current={app.view === item.view ? 'page' : undefined}
            onclick={() => navigate(item.view)}><Icon name={item.icon} /><span>{item.label}</span></button
          >
        {/each}
      </nav>
    {/if}
    <div class="aside-bottom">
      <button
        class="feedback-link"
        onclick={() => {
          moreOpen = false
          onfeedback()
        }}
      >
        Something confusing? Send feedback
      </button>
      <span
        class="live-dot"
        class:warn={['error', 'stale'].includes(remote.guildId ? remote.status : localSave.status)}
      ></span>
      {remote.guildId
        ? remote.status === 'error'
          ? 'Online · not saved'
          : remote.status === 'stale'
            ? 'Online · can’t reach the server'
            : remote.status === 'saving'
              ? 'Online · saving…'
              : 'Online · shared with your guild'
        : localSave.status === 'error'
          ? 'Browser changes not saved'
          : 'Saved in this browser'}
      <div class="user">
        <span class="avatar" aria-hidden="true">{initials}</span>
        {#if canManage() && (!remote.guildId || EDIT_AS_OTHER_PLAYERS)}
          <label class="field acting-as">
            {remote.guildId ? 'Editing as' : 'Acting as'}
            <select value={app.data.currentMemberId} onchange={switchMember}>
              {#each app.data.members as member (member.id)}
                <option value={member.id}>{member.name}</option>
              {/each}
            </select>
          </label>
        {:else}
          <div class="acting-as">
            {me?.name ?? 'Signed in'}<small>{remote.officer ? 'Officer' : 'Player'}</small>
          </div>
        {/if}
      </div>
      <nav class="legal-links" aria-label="Legal">
        <a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms</a>
      </nav>
    </div>
  </div>
</aside>

<style>
  .feedback-link {
    width: 100%;
    margin-bottom: 16px;
    text-align: left;
    font-size: 13px;
  }
</style>
