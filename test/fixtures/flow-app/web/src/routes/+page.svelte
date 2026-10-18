<script lang="ts">
  import Child from './Child.svelte';
  import { fetchSessions } from '../lib/api';
  const data = fetchSessions();
</script>
<Child {data} />
