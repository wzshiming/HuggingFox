<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import type { FacetGroup } from '$lib/listing/tags';
	import { toggleFacet, type ListingState } from '$lib/listing/query';
	import * as m from '$lib/paraglide/messages.js';
	import LoadError from './LoadError.svelte';

	let {
		listing,
		groups,
		error,
		pending,
		onretry,
		href
	}: {
		listing: ListingState;
		groups: FacetGroup[];
		error: unknown;
		pending: boolean;
		onretry: () => void;
		href: (next: ListingState) => string;
	} = $props();

	const labels: Record<string, () => string> = {
		pipeline_tag: m.facet_tasks,
		task_categories: m.facet_tasks,
		library: m.facet_libraries,
		dataset: m.nav_datasets,
		language: m.facet_languages,
		license: m.facet_licenses,
		size_categories: m.facet_sizes,
		modality: m.facet_modalities,
		format: m.facet_formats,
		sdk: m.facet_sdk,
		other: m.facet_other
	};
	const label = (param: string) => labels[param]?.() ?? param;

	let tab = $state<string | null>(null);
	let filter = $state('');
	let expanded = $state(false);
	const limit = 30;

	const current = $derived(groups.find((g) => g.param === tab) ?? groups[0]);
	const visible = $derived.by(() => {
		if (!current) return [];
		const needle = filter.trim().toLowerCase();
		const active = listing.facets[current.param] ?? [];
		return current.tags.filter(
			(t) => active.includes(t.id) || !needle || t.label.toLowerCase().includes(needle)
		);
	});
	const shown = $derived(expanded || filter ? visible : visible.slice(0, limit));
</script>

<div class="text-sm">
	{#if pending}
		<div class="space-y-2" aria-busy="true" aria-label={m.list_loading()}>
			{#each { length: 6 }, i (i)}
				<div class="h-6 animate-pulse rounded-full bg-gray-100 dark:bg-gray-800"></div>
			{/each}
		</div>
	{:else if error}
		<LoadError {error} what={m.filter_title()} {onretry} />
	{:else if groups.length}
		<div role="tablist" class="mb-3 flex flex-wrap gap-1">
			{#each groups as group (group.param)}
				<button
					type="button"
					role="tab"
					aria-selected={group === current}
					class="rounded-full px-2 py-0.5 {group === current
						? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
						: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}"
					onclick={() => {
						tab = group.param;
						filter = '';
						expanded = false;
					}}
				>
					{label(group.param)}
					{#if listing.facets[group.param]?.length}
						<span class="ml-0.5 text-xs opacity-70">{listing.facets[group.param].length}</span>
					{/if}
				</button>
			{/each}
		</div>
		{#if current}
			<label class="relative mb-3 block">
				<Search
					size={14}
					class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400"
					aria-hidden="true"
				/>
				<input
					type="search"
					class="form-input-alt h-8 w-full pr-2 pl-8"
					placeholder={m.filter_by_name({ what: label(current.param) })}
					aria-label={m.filter_by_name({ what: label(current.param) })}
					bind:value={filter}
				/>
			</label>
			<ul class="flex flex-wrap gap-1.5" aria-label={label(current.param)}>
				{#each shown as tag (tag.id)}
					{@const active = listing.facets[current.param]?.includes(tag.id) ?? false}
					<li>
						<a
							href={href(toggleFacet(listing, current.param, tag.id))}
							aria-current={active ? 'true' : undefined}
							class="inline-block max-w-full truncate rounded-lg border px-2 py-0.5 {active
								? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'
								: 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-925 dark:text-gray-300 dark:hover:bg-gray-800'}"
						>
							{tag.label}
						</a>
					</li>
				{/each}
			</ul>
			{#if !expanded && !filter && visible.length > limit}
				<button
					type="button"
					class="mt-2 text-gray-500 hover:underline"
					onclick={() => (expanded = true)}
				>
					{m.filter_show_all({ count: String(visible.length) })}
				</button>
			{/if}
		{/if}
	{:else}
		<p class="text-gray-500">{m.filter_none()}</p>
	{/if}
</div>
