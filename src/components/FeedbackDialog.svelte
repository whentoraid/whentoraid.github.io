<script>
  import { untrack } from 'svelte'
  import Modal from './Modal.svelte'
  import { app } from '../lib/app.svelte.js'
  import { remote } from '../lib/remote/sync.svelte.js'
  import { supabase } from '../lib/remote/client.js'
  import { downloadText } from '../lib/download.js'

  let { open, onclose } = $props()
  let message = $state('')
  let busy = $state(false)
  let error = $state('')
  let sent = $state(false)
  let context = $state(null)
  let reports = $state(null)
  let reportError = $state('')
  let request = null
  $effect(() => {
    if (!open) return
    untrack(() => {
      context = {
        guildId: remote.guildId,
        page: app.view,
        width: Math.min(10000, window.innerWidth),
        height: Math.min(10000, window.innerHeight),
      }
      message = ''
      error = ''
      sent = false
      reports = null
      reportError = ''
      request = null
    })
  })
  async function send(event) {
    event.preventDefault()
    if (busy || !message.trim()) return
    if (context.guildId !== remote.guildId) {
      error = 'The guild changed. Close and reopen feedback.'
      return
    }
    if (!supabase || !context.guildId) {
      downloadText(
        'whentoraid-feedback.txt',
        `${message.trim()}\n\nPage: ${context.page}\nScreen: ${context.width} × ${context.height}`,
        'text/plain',
      )
      sent = true
      return
    }
    const wanted = context
    if (!request || request.p_message !== message.trim())
      request = {
        p_id: crypto.randomUUID(),
        p_guild_id: context.guildId,
        p_message: message.trim(),
        p_page: context.page,
        p_width: context.width,
        p_height: context.height,
      }
    busy = true
    error = ''
    try {
      const result = await supabase.rpc('send_member_feedback', request)
      if (result.error) throw result.error
      if (context === wanted) sent = true
    } catch (failure) {
      if (context === wanted) error = failure.message
    } finally {
      busy = false
    }
  }
  async function readReports() {
    const guildId = remote.guildId
    const wanted = context
    reportError = ''
    try {
      const { data, error: failure } = await supabase.rpc('get_member_feedback', { p_guild_id: guildId })
      if (failure) throw failure
      if (guildId === remote.guildId && context === wanted) reports = data
    } catch (failure) {
      if (guildId === remote.guildId && context === wanted) reportError = failure.message
    }
  }
</script>

<Modal {open} {onclose} label="Something confusing?">
  <h2>Something confusing?</h2>
  {#if sent}
    <p role="status">
      {context?.guildId
        ? 'Thanks. Your guild officers can now read your feedback here.'
        : 'Feedback downloaded. Share the file with your guild officers.'}
    </p>
    <button onclick={onclose}>Done</button>
  {:else}
    <form onsubmit={send}>
      <label class="field"
        >What were you trying to do?
        <textarea
          bind:value={message}
          required
          maxlength="2000"
          rows="5"
          placeholder="Tell us what was unclear and what you expected."
          disabled={busy}></textarea>
      </label>
      <p class="note">
        Includes only your message, this screen ({context?.page}), and its size ({context?.width} × {context?.height}).
        Guild officers can read it.
      </p>
      {#if error}<p role="alert" class="warning">
          Feedback wasn’t confirmed: {error} Your message is kept; try again.
        </p>{/if}
      <div class="buttons">
        <button class="primary" disabled={busy || !message.trim()}
          >{busy ? 'Sending…' : context?.guildId ? 'Send feedback' : 'Download feedback'}</button
        >
        <button type="button" onclick={onclose}>Cancel</button>
      </div>
    </form>
  {/if}
  {#if remote.guildId && remote.officer}
    <details class="reports">
      <summary
        onclick={() => {
          if (reports === null) void readReports()
        }}>Recent guild feedback</summary
      >
      {#if reportError}<p role="alert">{reportError}</p>
        <button onclick={readReports}>Retry feedback</button>
      {:else if reports === null}<p>Loading feedback…</p>
      {:else if !reports.length}<p>No feedback yet.</p>
      {:else}<ul>
          {#each reports as report (report.id)}<li>
              <p>{report.message}</p>
              <small
                >{report.page} · {report.width} × {report.height} · {new Date(
                  report.created_at,
                ).toLocaleDateString()}</small
              >
            </li>{/each}
        </ul>{/if}
    </details>
  {/if}
</Modal>

<style>
  textarea {
    width: 100%;
    resize: vertical;
  }
  .reports {
    margin-top: 24px;
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  summary {
    cursor: pointer;
    min-height: 44px;
  }
  ul {
    padding-left: 20px;
  }
  li {
    margin-block: 16px;
    overflow-wrap: anywhere;
  }
  li p {
    white-space: pre-wrap;
    color: var(--text);
  }
</style>
