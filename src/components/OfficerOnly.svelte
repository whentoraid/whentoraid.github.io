<script>
  import { app } from '../lib/app.svelte.js'
  import PageTitle from './PageTitle.svelte'

  /** Shown when a player opens an officer page by link or URL. The server still enforces every write. */
</script>

<PageTitle
  eyebrow="GUILD TOOLS"
  title="This page is for officers"
  subtitle="Your raids, availability and characters are all in the menu. Ask an officer if you need more access."
/>
<button class="primary" onclick={() => (app.view = 'home')}>Go to My raids</button>
