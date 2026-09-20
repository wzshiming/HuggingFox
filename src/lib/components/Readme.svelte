<script lang="ts">
	import { ApiError } from '$lib/api/client';
	import { hub } from '$lib/auth.svelte';
	import { formatBytes } from '$lib/format';
	import { splitFrontmatter } from '$lib/markdown/frontmatter';
	import type { CardTarget } from '$lib/markdown/links';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import LoadError from './LoadError.svelte';
	import Markdown from './Markdown.svelte';

	let { target, exists = true }: { target: CardTarget; exists?: boolean } = $props();

	const file = createQuery(async (signal) =>
		exists ? hub.text(target.type, target.id, target.rev, 'README.md', {}, { signal }) : null
	);
	const card = $derived(file.data ? splitFrontmatter(file.data.text) : null);
	const missing = $derived(
		!exists || (file.error instanceof ApiError && file.error.status === 404)
	);
</script>

{#if file.pending}
	<div class="space-y-3" aria-busy="true" aria-label={m.list_loading()}>
		{#each [60, 100, 90, 40, 100, 80] as width, i (i)}
			<div
				class="h-4 animate-pulse rounded bg-gray-100 dark:bg-gray-800"
				style:width="{width}%"
			></div>
		{/each}
	</div>
{:else if missing}
	<div
		class="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700"
	>
		<p class="font-semibold">{m.card_missing()}</p>
		<p class="mt-1 text-sm">{m.card_missing_hint()}</p>
	</div>
{:else if file.error}
	<LoadError error={file.error} what="README.md" onretry={() => file.retry()} />
{:else if file.data && card}
	{#if file.data.truncated}
		<p
			role="status"
			class="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200"
		>
			{file.data.size === null
				? m.card_truncated()
				: m.card_too_large({ size: formatBytes(file.data.size) })}
		</p>
	{/if}
	{#if card.error}
		<p class="mb-4 text-sm text-gray-500">{m.card_frontmatter_invalid({ detail: card.error })}</p>
	{/if}
	{#if card.body.trim()}
		<Markdown source={card.body} {target} />
	{:else if !file.data.truncated}
		<p class="text-gray-500">{m.card_empty()}</p>
	{/if}
{/if}
