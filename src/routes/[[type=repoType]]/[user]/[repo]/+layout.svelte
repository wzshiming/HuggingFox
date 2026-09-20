<script lang="ts">
	import Box from '@lucide/svelte/icons/box';
	import Heart from '@lucide/svelte/icons/heart';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import Lock from '@lucide/svelte/icons/lock';
	import Table from '@lucide/svelte/icons/table';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { repoPagePath, treePagePath, type RepoType } from '$lib/api/url';
	import { auth } from '$lib/auth.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import LoadError from '$lib/components/LoadError.svelte';
	import { formatCompact } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { provideRepo } from '$lib/repo/context.svelte';
	import { tagChips } from '$lib/repo/meta';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const repo = provideRepo(() => ({ type: data.type, id: data.id }));
	const icons = { model: Box, dataset: Table, space: LayoutGrid };
	const cardLabels: Record<RepoType, () => string> = {
		model: m.tab_model_card,
		dataset: m.tab_dataset_card,
		space: m.tab_app
	};

	const owner = $derived(data.id.split('/')[0]);
	const name = $derived(data.id.slice(owner.length + 1));
	const base = $derived(repoPagePath(data.type, data.id));
	const info = $derived(repo.info.data);
	const status = $derived(repo.info.error instanceof ApiError ? repo.info.error.status : null);
	const chips = $derived(info ? tagChips(data.type, info) : []);
	const tabs = $derived([
		{ href: base, label: cardLabels[data.type](), section: 'card' },
		{
			href: treePagePath(data.type, data.id, repo.rev ?? 'main'),
			label: data.type === 'space' ? m.tab_files() : m.tab_files_versions(),
			section: 'files'
		},
		{ href: `${base}/discussions`, label: m.tab_community(), section: 'community' },
		// Shown to any signed-in user; the hub decides whether a write is allowed.
		...(auth.user
			? [{ href: `${base}/settings`, label: m.tab_settings(), section: 'settings' }]
			: [])
	]);
	// The files tab also covers the tree, blob, commits and file-management views.
	const current = $derived.by(() => {
		const path = page.url.pathname;
		const rest = path.startsWith(base) ? path.slice(base.length) : null;
		if (rest === '') return 'card';
		if (rest?.startsWith('/discussions')) return 'community';
		if (rest === '/settings') return 'settings';
		return rest && /^\/(?:tree|blob|commits?|resolve|upload|new|edit|delete)(?:\/|$)/.test(rest)
			? 'files'
			: null;
	});
	const Icon = $derived(icons[data.type]);
</script>

<svelte:head>
	<title>{data.id} &ndash; HuggingFox</title>
</svelte:head>

<header
	class="border-b border-gray-100 bg-linear-to-t from-gray-50 to-white dark:border-gray-800 dark:from-gray-925 dark:to-gray-950"
>
	<div class="container pt-6 sm:pt-9">
		<h1 class="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-lg leading-tight sm:text-xl">
			<Icon size={18} class="flex-none text-gray-400" aria-hidden="true" />
			<a href="/{encodeURIComponent(owner)}" class="text-gray-400 hover:text-blue-600">{owner}</a>
			<span class="text-gray-300 dark:text-gray-600">/</span>
			<a href={base} class="font-mono font-semibold break-all">{name}</a>
			<CopyButton text={data.id} label={m.copy_repo_id()} />
			{#if info?.private || info?.gated}
				<span
					class="flex items-center gap-0.5 rounded border border-gray-200 px-1.5 text-xs text-gray-500 dark:border-gray-700"
				>
					<Lock size={10} aria-hidden="true" />
					{info.private ? m.repo_private() : m.repo_gated()}
				</span>
			{/if}
			{#if typeof info?.likes === 'number'}
				<span
					class="flex items-center gap-1 rounded-md border border-gray-200 px-1.5 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300"
					title={m.repo_likes()}
				>
					<Heart size={13} aria-label={m.repo_likes()} />{formatCompact(info.likes)}
				</span>
			{/if}
		</h1>
		{#if chips.length}
			<ul class="mb-3 flex flex-wrap gap-1 text-sm" aria-label={m.repo_tags()}>
				{#each chips as chip (chip.tag)}
					<li>
						<a
							href={chip.href}
							class="inline-block max-w-full truncate rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-925 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							{chip.label}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		<nav aria-label={m.repo_sections()} class="-mb-px flex gap-x-6 overflow-x-auto text-smd">
			{#each tabs as tab (tab.section)}
				<a
					href={tab.href}
					aria-current={current === tab.section ? 'page' : undefined}
					class="flex-none border-b-2 py-2.5 whitespace-nowrap {current === tab.section
						? 'border-gray-800 font-semibold dark:border-gray-200'
						: 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}"
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	</div>
</header>

<div class="container pt-6 pb-16">
	{#if repo.info.pending}
		<div class="space-y-3" aria-busy="true" aria-label={m.list_loading()}>
			{#each [40, 100, 90, 70] as width, i (i)}
				<div
					class="h-4 animate-pulse rounded bg-gray-100 dark:bg-gray-800"
					style:width="{width}%"
				></div>
			{/each}
		</div>
	{:else if status === 404}
		<div class="py-16 text-center">
			<p class="text-7xl font-bold text-gray-200 dark:text-gray-800">404</p>
			<p class="mt-4 text-lg text-gray-600 dark:text-gray-400">
				{m.repo_not_found({ id: data.id })}
			</p>
			<a href="/" class="mt-8 inline-block underline">{m.error_back_home()}</a>
		</div>
	{:else if status === 401 || status === 403}
		<div class="py-16 text-center">
			<Lock size={40} class="mx-auto text-gray-300 dark:text-gray-700" aria-hidden="true" />
			<p class="mt-4 text-lg text-gray-600 dark:text-gray-400">
				{m.repo_restricted({ id: data.id })}
			</p>
			<p class="mt-2 text-sm text-gray-500">
				{(repo.info.error as ApiError).status}: {(repo.info.error as ApiError).detail}
			</p>
			{#if !auth.user}
				<a href="/login" class="mt-8 inline-block underline">{m.auth_login()}</a>
			{/if}
		</div>
	{:else if repo.info.error}
		<LoadError error={repo.info.error} what={data.id} onretry={() => repo.info.retry()} />
	{:else}
		{@render children()}
	{/if}
</div>
