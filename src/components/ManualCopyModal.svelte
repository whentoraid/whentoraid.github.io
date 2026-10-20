<script>
  import Modal from './Modal.svelte'

  /** Messages to copy by hand when the clipboard API is unavailable (e.g. not a secure context). */
  let { messages, onclose } = $props()
</script>

<Modal open={messages !== null} {onclose} label="Copy for Discord">
  <h2>Copy for Discord</h2>
  <p>
    Your browser blocked clipboard access. Select the text below and copy it{messages?.length > 1
      ? ', one message at a time'
      : ''}.
  </p>
  {#each messages ?? [] as message, i (i)}
    {#if messages.length > 1}<h3>Message {i + 1} of {messages.length}</h3>{/if}
    <textarea
      class="copy-box"
      readonly
      rows="14"
      aria-label="Message {i + 1}"
      value={message}
      onfocus={(e) => e.currentTarget.select()}></textarea>
  {/each}
</Modal>
