<script context="module" lang="ts">
	export const PAGE_SIZE = 20;
</script>

<script lang="ts">
	import type { Session } from '@scope/core';
	import { clamp } from '@scope/shared';
	import Card from '$lib/components/Card.svelte';

	let { sessions }: { sessions: Session[] } = $props();

	function visible(count: number): Session[] {
		return sessions.slice(0, clamp(count, 0, PAGE_SIZE));
	}
</script>

{#each visible(PAGE_SIZE) as session (session.id)}
	<Card {session} onselect={() => {}} />
{/each}
