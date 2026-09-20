<script lang="ts">
	import { treePagePath, type RepoType } from '$lib/api/url';
	import { crumbs } from '$lib/files/kind';
	import * as m from '$lib/paraglide/messages.js';
	import CopyButton from './CopyButton.svelte';

	let { type, id, rev, path }: { type: RepoType; id: string; rev: string; path: string } = $props();

	const name = $derived(id.slice(id.indexOf('/') + 1));
	const parts = $derived(crumbs(path));
</script>

<nav aria-label={m.files_table()} class="flex min-w-0 items-center gap-1.5 text-smd">
	<ol class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
		<li>
			{#if path}
				<a href={treePagePath(type, id, rev)} class="font-semibold hover:underline">{name}</a>
			{:else}
				<span class="font-semibold">{name}</span>
			{/if}
		</li>
		{#each parts as part, i (part.path)}
			<li class="flex min-w-0 items-center gap-1.5">
				<span class="text-gray-300 dark:text-gray-600" aria-hidden="true">/</span>
				{#if i < parts.length - 1}
					<a href={treePagePath(type, id, rev, part.path)} class="truncate hover:underline"
						>{part.name}</a
					>
				{:else}
					<span class="truncate font-semibold" aria-current="page">{part.name}</span>
				{/if}
			</li>
		{/each}
	</ol>
	{#if path}
		<CopyButton text={path} label={m.files_copy_path()} />
	{/if}
</nav>
