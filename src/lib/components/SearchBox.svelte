<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import type { QuickSearch } from '$lib/api/types';
	import { repoPagePath, type RepoType } from '$lib/api/url';
	import { auth, hub } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages.js';

	interface Item {
		group: string;
		label: string;
		href: string;
	}

	let query = $state('');
	let open = $state(false);
	let active = $state(-1);
	let items = $state<Item[]>([]);
	let root: HTMLElement;
	let seq = 0;
	let controller: AbortController | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const groupLabel: Record<RepoType, () => string> = {
		model: m.nav_models,
		dataset: m.nav_datasets,
		space: m.nav_spaces
	};
	const repoTypes: RepoType[] = ['model', 'dataset', 'space'];

	const allHref = $derived(`/models?search=${encodeURIComponent(query.trim())}`);
	const groups = $derived(
		[...new Set(items.map((item) => item.group))].map((group) => ({
			group,
			items: items.filter((item) => item.group === group)
		}))
	);

	function fromQuick(quick: QuickSearch): Item[] {
		const repos = repoTypes.flatMap((type) =>
			(quick[`${type}s` as const] ?? []).map((repo) => ({
				group: groupLabel[type](),
				label: repo.id,
				href: repoPagePath(type, repo.id)
			}))
		);
		const people = [
			...(quick.users ?? []).map((u) => ({
				label: u.user,
				href: `/${encodeURIComponent(u.user)}`
			})),
			...(quick.orgs ?? []).map((o) => ({ label: o.name, href: `/${encodeURIComponent(o.name)}` }))
		].map((p) => ({ group: m.search_users(), ...p }));
		return [...repos, ...people];
	}

	async function search(q: string) {
		controller?.abort();
		controller = new AbortController();
		const { signal } = controller;
		const mine = ++seq;
		try {
			const quick = await hub.quicksearch(q, { limit: 5 }, { signal });
			let found: Item[];
			if (quick) {
				found = fromQuick(quick);
			} else {
				const pages = await Promise.all(
					repoTypes.map((type) => hub.listRepos(type, { search: q, limit: 5 }, { signal }))
				);
				found = pages.flatMap((page, i) =>
					page.items.map((repo) => ({
						group: groupLabel[repoTypes[i]](),
						label: repo.id,
						href: repoPagePath(repoTypes[i], repo.id)
					}))
				);
			}
			if (mine !== seq) return;
			items = found;
		} catch {
			if (mine !== seq || signal.aborted) return;
			items = [];
		}
		active = -1;
		open = true;
	}

	function invalidate() {
		clearTimeout(timer);
		seq++;
		controller?.abort();
		items = [];
		open = false;
		active = -1;
	}

	// Results may be private: drop them and any pending request on session change or unmount.
	$effect(() => {
		void auth.session;
		return invalidate;
	});

	function oninput() {
		invalidate();
		const q = query.trim();
		if (q) timer = setTimeout(() => search(q), 200);
	}

	function close() {
		open = false;
		active = -1;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const href = items[active]?.href ?? (query.trim() ? allHref : null);
		close();
		if (href) goto(href);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			close();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (!items.length) return;
			event.preventDefault();
			open = true;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + items.length + 1) % (items.length + 1);
			if (active === items.length) active = -1;
		}
	}

	function onfocusout(event: FocusEvent) {
		if (!root.contains(event.relatedTarget as Node | null)) close();
	}
</script>

<form
	role="search"
	class="relative mr-2 flex-1 sm:mr-4 lg:max-w-sm"
	bind:this={root}
	onsubmit={submit}
	{onfocusout}
>
	<Search
		size={16}
		class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400"
		aria-hidden="true"
	/>
	<input
		type="text"
		name="search"
		class="form-input-alt h-9 w-full pr-3 pl-8"
		placeholder={m.search_placeholder()}
		aria-label={m.search_label()}
		role="combobox"
		aria-expanded={open}
		aria-controls="search-results"
		aria-autocomplete="list"
		aria-activedescendant={active >= 0 ? `search-option-${active}` : undefined}
		autocomplete="off"
		spellcheck="false"
		bind:value={query}
		{oninput}
		{onkeydown}
		onfocus={() => {
			if (items.length) open = true;
		}}
	/>
	{#if open}
		<ul
			id="search-results"
			role="listbox"
			aria-label={m.search_results()}
			class="absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-auto rounded-lg border border-gray-100 bg-white py-1 text-sm shadow-lg dark:border-gray-800 dark:bg-gray-925"
		>
			{#each groups as { group, items: members } (group)}
				<li
					role="presentation"
					class="px-3 pt-2 pb-1 text-xs font-semibold text-gray-500 uppercase"
				>
					{group}
				</li>
				{#each members as item (item.href)}
					{@const index = items.indexOf(item)}
					<li
						id="search-option-{index}"
						role="option"
						aria-selected={index === active}
						class="mx-1 rounded"
						class:bg-gray-100={index === active}
						class:dark:bg-gray-800={index === active}
					>
						<a
							href={item.href}
							tabindex="-1"
							class="block truncate px-2 py-1.5 font-mono hover:bg-gray-100 dark:hover:bg-gray-800"
							onclick={close}
						>
							{item.label}
						</a>
					</li>
				{/each}
			{/each}
			{#if !items.length}
				<li class="px-3 py-2 text-gray-500">{m.search_no_results({ query: query.trim() })}</li>
			{/if}
			<li role="presentation" class="mx-1 mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">
				<a
					href={allHref}
					tabindex="-1"
					class="block px-2 py-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
					onclick={close}
				>
					{m.search_all_results({ query: query.trim() })}
				</a>
			</li>
		</ul>
	{/if}
</form>
