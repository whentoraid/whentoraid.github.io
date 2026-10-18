<script>
  import { dismissToast, pauseToast, resumeToast, runToastAction, toast } from '../lib/toast.svelte.js'

  /** The toast hides itself, so a keyboard user's focus moves to the page instead of being lost. */
  function thenRefocus(run) {
    return () => {
      run()
      document.getElementById('content')?.focus({ preventScroll: true })
    }
  }
</script>

<div
  id="toast"
  role="group"
  aria-label="Notification"
  style:display={toast.visible ? 'flex' : 'none'}
  onpointerenter={() => pauseToast('pointer')}
  onpointerleave={() => resumeToast('pointer')}
  onfocusin={() => pauseToast('focus')}
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) resumeToast('focus')
  }}
>
  <span role="status">{toast.message}</span>
  {#if toast.action}
    <button class="toast-action" onclick={thenRefocus(runToastAction)}>{toast.action.label}</button>
  {/if}
  <button class="toast-action" aria-label="Dismiss notification" onclick={thenRefocus(dismissToast)}>×</button
  >
</div>
