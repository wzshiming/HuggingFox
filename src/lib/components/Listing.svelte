<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import X from '@lucide/svelte/icons/x';
	import { onDestroy } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { listPagePath, type RepoType } from '$lib/api/url';
	import { hub } from '$lib/auth.svelte';
	import {
		cursorOf,
		listingParams,
		listingSearch,
		parseListing,
		sortKeys,
		toggleFacet,
		withListing,
		type ListingState,
		type SortKey
	} from '$lib/listing/query';
	import { facetGroups, observedFacets, type FacetGroup } from '$lib/listing/tags';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import FilterSidebar from './FilterSidebar.svelte';
	import LoadError from './LoadError.svelte';
	import RepoGrid from './RepoGrid.svelte';

	let { type }: { type: RepoType } = $props();

	const limit = 30;
	const titles: Record<RepoType, () => string> = {
		model: m.nav_models,
		dataset: m.nav_datasets,
		space: m.nav_spaces
	};
	const sortLabels: Record<SortKey, () => string> = {
		trending: m.sort_trending,
		likes: m.sort_likes,
		downloads: m.sort_downloads,
		created: m.sort_created,
		modified: m.sort_modified
	};

	const listing = $derived(parseListing(type, page.url.searchParams));
	const href = (next: ListingState) => {
		const search = listingSearch(next).toString();
		return listPagePath(type) + (search ? `?${search}` : '');
	};

	const repos = createQuery((signal) =>
		hub.listRepos(type, listingParams(type, listing, limit), { signal })
	);
	// Spaces have no tags-by-type endpoint; null means the hub does not offer it either.
	const tags = createQuery(async (signal) =>
		type === 'space' ? null : hub.tagsByType(type, { signal })
	);
	const groups = $derived.by((): FacetGroup[] => {
		const base = tags.data
			? facetGroups(type, tags.data)
			: observedFacets(type, repos.data?.items ?? []);
		// Active values must stay visible even when the current page no longer carries them.
		for (const [param, values] of Object.entries(listing.facets)) {
			let group = base.find((g) => g.param === param);
			if (!group) base.push((group = { param, tags: [] }));
			for (const id of values) {
				if (!group.tags.some((t) => t.id === id)) {
					group.tags.push({ id, label: id.includes(':') ? id.slice(id.indexOf(':') + 1) : id });
				}
			}
		}
		return base;
	});
	const active = $derived(
		Object.entries(listing.facets).flatMap(([param, values]) =>
			values.map((value) => ({ param, value }))
		)
	);

	let filtersOpen = $state(false);
	let q = $state('');
	let submitted = '';
	let target = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (listing.search !== submitted) q = submitted = listing.search;
	});
	// Any navigation other than our own debounced search drops it and mirrors the url again.
	beforeNavigate(({ to }) => {
		if (to && to.url.pathname + to.url.search === target) return;
		clearTimeout(timer);
		q = listing.search;
	});
	onDestroy(() => clearTimeout(timer));
	function applySearch() {
		clearTimeout(timer);
		const next = q.trim();
		if (next === listing.search) return;
		submitted = next;
		target = href(withListing(listing, { search: next }));
		goto(target, { replaceState: true, keepFocus: true, noScroll: true });
	}
	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(applySearch, 300);
	}

	const total = $derived(repos.data?.total ?? null);
	const nextCursor = $derived(cursorOf(repos.data?.next ?? null));
	const nextHref = $derived(nextCursor ? href(withListing(listing, { cursor: nextCursor })) : null);
	const prevKey = (url: string) => `hfx.prev:${url}`;
	const here = $derived(page.url.pathname + page.url.search);
	// Previous page is whatever url we paged from; a cold start falls back to the first page.
	const prevHref = $derived(
		listing.cursor
			? (sessionStorage.getItem(prevKey(here)) ?? href(withListing(listing, {})))
			: null
	);
</script>

<svelte:head>
	<title>{titles[type]()} &ndash; HuggingFox</title>
</svelte:head>

<div class="container flex flex-col lg:flex-row lg:gap-8">
	<aside
		id="listing-filters"
		class="pt-6 lg:sticky lg:top-0 lg:max-h-dvh lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-gray-100 lg:pr-6 lg:pb-8 xl:w-80 lg:dark:border-gray-800 {filtersOpen
			? 'block'
			: 'hidden lg:block'}"
	>
		<h2 class="mb-3 text-sm font-semibold text-gray-500 uppercase">{m.filter_title()}</h2>
		<FilterSidebar
			{listing}
			{groups}
			error={tags.error}
			pending={tags.pending || (!tags.data && repos.pending)}
			onretry={() => tags.retry()}
			{href}
		/>
	</aside>

	<section class="min-w-0 flex-1 pt-6 pb-16">
		<header>
			<div class="flex flex-wrap items-center gap-3">
				<h1 class="text-2xl font-semibold">
					{titles[type]()}
					{#if total !== null}
						<span class="ml-1 font-normal text-gray-400" data-testid="listing-count">
							{total.toLocaleString(document.documentElement.lang || 'en')}
						</span>
					{/if}
				</h1>
				<button
					type="button"
					class="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-sm lg:hidden dark:border-gray-700"
					aria-expanded={filtersOpen}
					aria-controls="listing-filters"
					onclick={() => (filtersOpen = !filtersOpen)}
				>
					<SlidersHorizontal size={14} aria-hidden="true" />
					{m.filter_title()}
					{#if active.length}<span class="text-gray-500">{active.length}</span>{/if}
				</button>
				<form
					role="search"
					class="relative flex-1 basis-48 sm:ml-auto sm:max-w-xs"
					onsubmit={(event) => {
						event.preventDefault();
						applySearch();
					}}
				>
					<Search
						size={14}
						class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400"
						aria-hidden="true"
					/>
					<input
						type="search"
						name="search"
						class="form-input-alt h-8 w-full pr-2 pl-8"
						placeholder={m.listing_filter_by_name()}
						aria-label={m.listing_filter_by_name()}
						autocomplete="off"
						bind:value={q}
						{oninput}
					/>
				</form>
				<label class="flex items-center gap-1.5 text-sm">
					<span class="text-gray-500">{m.sort_label()}</span>
					<select
						class="form-input-alt h-8 px-2"
						value={listing.sort}
						onchange={(event) =>
							goto(href(withListing(listing, { sort: event.currentTarget.value as SortKey })))}
					>
						{#each sortKeys as key (key)}
							<option value={key}>{sortLabels[key]()}</option>
						{/each}
					</select>
				</label>
			</div>
			{#if active.length || listing.author}
				<ul class="mt-3 flex flex-wrap items-center gap-2 text-sm" aria-label={m.filter_active()}>
					{#if listing.author}
						<li>
							<a
								href={href(withListing(listing, { author: '' }))}
								class="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
								aria-label={m.filter_remove({ what: listing.author })}
							>
								{m.filter_author({ name: listing.author })}
								<X size={12} aria-hidden="true" />
							</a>
						</li>
					{/if}
					{#each active as { param, value } (param + value)}
						<li>
							<a
								href={href(toggleFacet(listing, param, value))}
								class="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-800 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900"
								aria-label={m.filter_remove({ what: value })}
							>
								{value.includes(':') ? value.slice(value.indexOf(':') + 1) : value}
								<X size={12} aria-hidden="true" />
							</a>
						</li>
					{/each}
					<li>
						<a href={listPagePath(type)} class="text-gray-500 hover:underline">
							{m.filter_clear()}
						</a>
					</li>
				</ul>
			{/if}
		</header>

		<div class="mt-6">
			{#if repos.pending}
				<ul
					class="grid grid-cols-1 gap-3 xl:grid-cols-2"
					aria-busy="true"
					aria-label={m.list_loading()}
				>
					{#each { length: 8 }, i (i)}
						<li class="overview-card h-14 animate-pulse bg-gray-50 dark:bg-gray-900"></li>
					{/each}
				</ul>
			{:else if repos.error}
				<LoadError error={repos.error} what={titles[type]()} onretry={() => repos.retry()} />
			{:else if !repos.data?.items.length}
				<p class="overview-card p-8 text-center text-gray-500">
					{m.listing_empty({ what: titles[type]() })}
					{#if active.length || listing.search || listing.author || listing.cursor}
						<a href={listPagePath(type)} class="ml-1 underline">{m.filter_clear()}</a>
					{/if}
				</p>
			{:else}
				<RepoGrid {type} items={repos.data.items} />
			{/if}
		</div>

		{#if prevHref || nextHref}
			<nav class="mt-8 flex justify-center gap-3 text-sm" aria-label={m.pagination_label()}>
				{#if prevHref}
					<a
						href={prevHref}
						rel="prev"
						class="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
					>
						<ChevronLeft size={14} aria-hidden="true" />{m.pagination_previous()}
					</a>
				{/if}
				{#if nextHref}
					<a
						href={nextHref}
						rel="next"
						class="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
						onclick={() => sessionStorage.setItem(prevKey(nextHref), here)}
					>
						{m.pagination_next()}<ChevronRight size={14} aria-hidden="true" />
					</a>
				{/if}
			</nav>
		{/if}
	</section>
</div>
