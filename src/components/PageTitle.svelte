<script>
  import Icon from './Icon.svelte'
  let { eyebrow, title, subtitle, action, icon } = $props()
</script>

<div class="title-row">
  <div class="page-heading">
    {#if icon}<span class="page-mark"><Icon name={icon} size={25} /></span>{/if}
    <div>
      <div class="eyebrow gold">{eyebrow}</div>
      <h1>{title}</h1>
      <p class="subtitle">{subtitle}</p>
    </div>
  </div>
  {@render action?.()}
</div>
