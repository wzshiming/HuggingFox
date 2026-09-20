<script lang="ts">
	import Heart from '@lucide/svelte/icons/heart';
	import Lock from '@lucide/svelte/icons/lock';
	import type { RepoSummary } from '$lib/api/types';
	import { repoPagePath } from '$lib/api/url';
	import { formatCompact } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';

	let { repo }: { repo: RepoSummary } = $props();

	const from: Record<string, string> = {
		red: 'from-red-500',
		yellow: 'from-yellow-500',
		green: 'from-green-500',
		blue: 'from-blue-500',
		indigo: 'from-indigo-500',
		purple: 'from-purple-500',
		pink: 'from-pink-500',
		gray: 'from-gray-500'
	};
	const to: Record<string, string> = {
		red: 'to-red-700',
		yellow: 'to-yellow-700',
		green: 'to-green-700',
		blue: 'to-blue-700',
		indigo: 'to-indigo-700',
		purple: 'to-purple-700',
		pink: 'to-pink-700',
		gray: 'to-gray-700'
	};
	const names = Object.keys(from);

	// Cards without card colours get a stable palette entry derived from the id.
	const pick = (id: string, offset: number) => {
		let hash = offset;
		for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 1024;
		return names[hash % names.length];
	};
	const card = $derived((repo.cardData ?? {}) as Record<string, unknown>);
	const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
	const colorFrom = $derived(from[str(card.colorFrom) ?? ''] ?? from[pick(repo.id, 0)]);
	const colorTo = $derived(to[str(card.colorTo) ?? ''] ?? to[pick(repo.id, 7)]);
	const title = $derived(str(card.title) ?? repo.title ?? repo.id.split('/').pop() ?? repo.id);
	const emoji = $derived(repo.emoji ?? str(card.emoji));
	const author = $derived(repo.author ?? repo.id.split('/')[0]);
</script>

<article class="overview-card group/repo relative flex h-40 flex-col overflow-hidden">
	<a
		class="flex h-full flex-col bg-linear-to-br {colorFrom} {colorTo} p-3 text-white"
		href={repoPagePath('space', repo.id)}
	>
		<div class="flex items-start justify-between gap-2 text-xs">
			<span class="truncate rounded-full bg-black/25 px-2 py-0.5">{author}</span>
			{#if repo.private}
				<span class="flex flex-none items-center gap-0.5 rounded-full bg-black/25 px-2 py-0.5">
					<Lock size={10} aria-hidden="true" />{m.repo_private()}
				</span>
			{/if}
		</div>
		<h4 class="mt-auto flex items-center gap-2 text-lg leading-tight font-semibold">
			{#if emoji}<span aria-hidden="true">{emoji}</span>{/if}
			<span class="line-clamp-2 break-words">{title}</span>
		</h4>
		<div class="mt-2 flex items-center gap-2 text-xs opacity-90">
			{#if repo.sdk}<span class="rounded bg-black/25 px-1.5 py-px uppercase">{repo.sdk}</span>{/if}
			{#if typeof repo.likes === 'number'}
				<span class="ml-auto flex items-center gap-0.5">
					<Heart size={12} aria-label={m.repo_likes()} />{formatCompact(repo.likes)}
				</span>
			{/if}
		</div>
	</a>
</article>
