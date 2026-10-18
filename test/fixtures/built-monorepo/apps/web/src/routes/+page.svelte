<script lang="ts">
	import { createSession } from '@scope/core';
	import List from '../lib/components/List.svelte';

	const sessions = [createSession('first')];
</script>

<List {sessions} />
