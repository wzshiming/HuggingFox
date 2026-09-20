<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import Tag from '@lucide/svelte/icons/tag';
	import { page } from '$app/state';
	import type { RepoRefs } from '$lib/api/types';
	import * as m from '$lib/paraglide/messages.js';

	let {
		refs,
		current,
		href
	}: { refs: RepoRefs | undefined; current: string; href: (name: string) => string } = $props();

	let open = $state(false);
	let tab = $state<'branches' | 'tags'>('branches');
	let filter = $state('');
	let root = $state<HTMLElement>();

	const branches = $derived(refs?.branches ?? []);
	const tags = $derived(refs?.tags ?? []);
	const Icon = $derived(
		branches.some((r) => r.name === current)
			? GitBranch
			: tags.some((r) => r.name === current)
				? Tag
				: GitCommitHorizontal
	);
	const shown = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		return (tab === 'branches' ? branches : tags)
			.filter((r) => r.name.toLowerCase().includes(needle))
			.slice(0, 200);
	});
	const tabs = [
		{ id: 'branches', label: m.ref_branches, count: () => branches.length },
		{ id: 'tags', label: m.ref_tags, count: () => tags.length }
	] as const;

	$effect(() => {
		void page.url.pathname;
		open = false;
	});
</script>

<div
	class="relative"
	bind:this={root}
	onfocusout={(e) => {
		if (!root?.contains(e.relatedTarget as Node | null)) open = false;
	}}
>
	<button
		type="button"
		class="flex h-8 max-w-56 items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
		aria-expanded={open}
		aria-label="{m.ref_switch()}: {current}"
		onclick={() => (open = !open)}
		onkeydown={(e) => e.key === 'Escape' && (open = false)}
	>
		<Icon size={14} class="flex-none text-gray-500" aria-hidden="true" />
		<span class="truncate font-mono">{current}</span>
		<ChevronDown size={14} class="flex-none text-gray-400" aria-hidden="true" />
	</button>
	{#if open}
		<div
			class="absolute left-0 z-40 mt-1 w-72 rounded-lg border border-gray-200 bg-white text-sm shadow-lg dark:border-gray-700 dark:bg-gray-925"
		>
			<div class="p-2">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="search"
					class="form-input-alt h-8 w-full px-2"
					placeholder={m.ref_search()}
					aria-label={m.ref_search()}
					autofocus
					bind:value={filter}
					onkeydown={(e) => e.key === 'Escape' && (open = false)}
				/>
			</div>
			<div role="tablist" class="flex border-b border-gray-200 px-2 dark:border-gray-700">
				{#each tabs as item (item.id)}
					<button
						type="button"
						role="tab"
						aria-selected={tab === item.id}
						class="-mb-px border-b-2 px-2 py-1.5 {tab === item.id
							? 'border-gray-800 font-semibold dark:border-gray-200'
							: 'border-transparent text-gray-500'}"
						onclick={() => (tab = item.id)}
					>
						{item.label()}
						<span class="ml-1 text-xs text-gray-400">{item.count()}</span>
					</button>
				{/each}
			</div>
			<div role="tabpanel" class="max-h-64 overflow-y-auto py-1">
				<ul>
					{#each shown as ref (ref.name)}
						<li>
							<a
								href={href(ref.name)}
								class="block truncate px-3 py-1.5 font-mono hover:bg-gray-50 dark:hover:bg-gray-800"
								aria-current={ref.name === current ? 'true' : undefined}
								class:font-semibold={ref.name === current}
							>
								{ref.name}
							</a>
						</li>
					{:else}
						<li class="px-3 py-2 text-gray-500">{m.ref_none()}</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}
</div>
