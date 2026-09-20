<script lang="ts">
	import type { RepoSummary } from '$lib/api/types';
	import type { RepoType } from '$lib/api/url';
	import RepoCard from './RepoCard.svelte';
	import SpaceCard from './SpaceCard.svelte';

	let { type, items }: { type: RepoType; items: RepoSummary[] } = $props();
</script>

<ul
	class="grid grid-cols-1 gap-3 {type === 'space'
		? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
		: 'gap-y-2.5 xl:grid-cols-2 xl:gap-x-5'}"
>
	{#each items as repo (repo.id)}
		<li>
			{#if type === 'space'}<SpaceCard {repo} />{:else}<RepoCard {type} {repo} />{/if}
		</li>
	{/each}
</ul>
