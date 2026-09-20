<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Heart from '@lucide/svelte/icons/heart';
	import Lock from '@lucide/svelte/icons/lock';
	import type { RepoSummary } from '$lib/api/types';
	import { repoPagePath, type RepoType } from '$lib/api/url';
	import { formatCompact, formatDate, formatRelative } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';

	let { type, repo }: { type: RepoType; repo: RepoSummary } = $props();

	const stats = $derived(
		[
			{ icon: Download, value: repo.downloads, label: m.repo_downloads() },
			{ icon: Heart, value: repo.likes, label: m.repo_likes() }
		].filter((stat) => typeof stat.value === 'number')
	);
</script>

<article class="overview-card group/repo">
	<a class="flex items-center justify-between gap-4 p-2" href={repoPagePath(type, repo.id)}>
		<div class="w-full truncate">
			<header class="mb-0.5 flex items-center gap-1.5" title={repo.id}>
				{#if repo.emoji}<span aria-hidden="true">{repo.emoji}</span>{/if}
				<h4
					class="truncate font-mono text-smd text-black group-hover/repo:text-indigo-600 dark:text-gray-200 dark:group-hover/repo:text-yellow-500"
				>
					{repo.id}
				</h4>
				{#if repo.private || repo.gated}
					<span
						class="flex flex-none items-center gap-0.5 rounded border border-gray-200 px-1 text-xs text-gray-500 dark:border-gray-700"
					>
						<Lock size={10} aria-hidden="true" />
						{repo.private ? m.repo_private() : m.repo_gated()}
					</span>
				{/if}
			</header>
			<div
				class="mr-1 flex items-center overflow-hidden text-sm leading-tight whitespace-nowrap text-gray-400 dark:text-gray-500"
			>
				{#if repo.pipeline_tag}
					<span class="truncate">{repo.pipeline_tag}</span>
				{/if}
				{#if repo.lastModified}
					{#if repo.pipeline_tag}<span class="px-1.5 text-gray-300 dark:text-gray-600">•</span>{/if}
					<time class="truncate" datetime={repo.lastModified} title={formatDate(repo.lastModified)}>
						{m.repo_updated({ when: formatRelative(repo.lastModified) })}
					</time>
				{/if}
				{#each stats as stat (stat.label)}
					{#if repo.pipeline_tag || repo.lastModified || stat !== stats[0]}
						<span class="px-1.5 text-gray-300 dark:text-gray-600">•</span>
					{/if}
					<stat.icon size={14} class="mr-0.5 flex-none" aria-label={stat.label} />
					{formatCompact(stat.value ?? 0)}
				{/each}
			</div>
		</div>
	</a>
</article>
