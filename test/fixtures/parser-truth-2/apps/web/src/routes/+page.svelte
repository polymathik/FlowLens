<script lang="ts">
  import { api } from '#lib/api.js';
  import { formatName } from '#lib';
  import { title } from '$lib/util.js';
  import { writeTextPref } from '#lib/prefs.js';
  import Canvas from '#lib/components/Canvas.svelte';
  import { goto } from '$app/navigation';
  import { PUBLIC_KEY } from '$env/static/public';
  import { ghost } from '#lib/ghost.js';

  let query = $state('');
  function reset() {
    query = '';
  }

  async function load() {
    await api.workspace();
    writeTextPref('k', formatName(title('x')));
    goto(PUBLIC_KEY);
    ghost();
  }
</script>

<input bind:value={query} />
<button onclick={load}>load</button>
<button onclick={() => reset()}>reset</button>
<Canvas onclose={reset} />
<Canvas />
