<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { ApiError, type ListReposParams } from '$lib/api/client';
	import type { RepoType } from '$lib/api/url';
	import { auth, hub } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import RepoCard from './RepoCard.svelte';

	let { type, params, what }: { type: RepoType; params: ListReposParams; what: string } = $props();

	let attempt = $state(0);
	// Re-runs on retry and whenever the session changes, so a sign-out drops signed-in results.
	const page = $derived.by(() => {
		void auth.session;
		void attempt;
		return hub.listRepos(type, params);
	});
</script>

{#await page}
	<ul class="flex flex-col gap-2.5" aria-busy="true" aria-label={m.list_loading()}>
		{#each { length: Math.min(params.limit ?? 5, 8) }, i (i)}
			<li class="overview-card h-12 animate-pulse bg-gray-50 dark:bg-gray-900"></li>
		{/each}
	</ul>
{:then result}
	{#if result.items.length}
		<ul class="flex flex-col gap-2.5">
			{#each result.items as repo (repo.id)}
				<li><RepoCard {type} {repo} /></li>
			{/each}
		</ul>
	{:else}
		<p class="overview-card p-4 text-center text-sm text-gray-500">{m.list_empty()}</p>
	{/if}
{:catch error}
	<div
		role="alert"
		class="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
	>
		<CircleAlert size={18} aria-hidden="true" />
		<p class="text-center">
			{m.list_error({
				what,
				detail: error instanceof ApiError ? error.detail : String(error?.message ?? error)
			})}
		</p>
		<button
			type="button"
			class="rounded-full border border-red-300 px-3 py-0.5 hover:bg-white dark:border-red-800 dark:hover:bg-red-900"
			onclick={() => attempt++}
		>
			{m.list_retry()}
		</button>
	</div>
{/await}
