<!-- A card for one session. <Icon /> in this comment must not count as a usage. -->
<script lang="ts">
	import type { Session } from '@scope/core';
	import { formatDuration } from '@scope/core/utils/format';
	import Icon from './Icon.svelte';

	let { session, onselect }: { session: Session; onselect: (s: Session) => void } = $props();

	function select() {
		onselect(session);
	}
</script>

<button onclick={select}>
	<Icon name="session" />
	<span>{session.title}</span>
	<small>{formatDuration(session.startedAt)}</small>
</button>

<style>
	button {
		color: var(--accent);
	}
</style>
