<script lang="ts">
	import Box from '@lucide/svelte/icons/box';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import Table from '@lucide/svelte/icons/table';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { listPagePath, repoPagePath, type RepoType } from '$lib/api/url';
	import { hub } from '$lib/auth.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import LoadError from '$lib/components/LoadError.svelte';
	import RepoGrid from '$lib/components/RepoGrid.svelte';
	import { formatCompact } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';

	const user = $derived(page.params.user ?? '');
	const overview = createQuery((signal) => hub.userOverview(user, { signal }));
	// Only a 404 means the hub has no profile; other failures stay visible.
	const notFound = $derived(overview.error instanceof ApiError && overview.error.status === 404);
	const profile = $derived(overview.data);

	const list = (type: RepoType) =>
		createQuery((signal) =>
			hub.listRepos(
				type,
				{ author: user, sort: 'trendingScore', direction: -1, limit: 30 },
				{ signal }
			)
		);
	const sections = [
		{ type: 'model' as RepoType, label: m.nav_models, icon: Box, count: 'numModels' as const },
		{
			type: 'dataset' as RepoType,
			label: m.nav_datasets,
			icon: Table,
			count: 'numDatasets' as const
		},
		{
			type: 'space' as RepoType,
			label: m.nav_spaces,
			icon: LayoutGrid,
			count: 'numSpaces' as const
		}
	].map((section) => ({ ...section, repos: list(section.type) }));

	const countOf = (section: (typeof sections)[number]) => {
		const known = profile?.[section.count] ?? section.repos.data?.total;
		if (typeof known === 'number') return known.toLocaleString();
		const items = section.repos.data?.items;
		return items ? `${items.length}${section.repos.data?.next ? '+' : ''}` : null;
	};

	// Legacy unnamespaced model ids (e.g. gpt2) collide with author urls: one bounded info lookup.
	let aliasChecked: string | null = null;
	$effect(() => {
		if (!notFound || aliasChecked === user || sections.some((s) => s.repos.pending)) return;
		if (sections.some((s) => s.repos.data?.items.length)) return;
		aliasChecked = user;
		const controller = new AbortController();
		hub.info('model', user, {}, { signal: controller.signal }).then(
			(info) => {
				if (info.id.includes('/')) goto(repoPagePath('model', info.id), { replaceState: true });
			},
			() => undefined
		);
		return () => controller.abort();
	});
</script>

<svelte:head>
	<title>{profile?.fullname || user} &ndash; HuggingFox</title>
</svelte:head>

<header
	class="border-b border-gray-100 bg-linear-to-t from-gray-50 to-white dark:border-gray-800 dark:from-gray-925 dark:to-gray-950"
>
	<div class="container flex items-center gap-4 py-8">
		<Avatar src={profile?.avatarUrl} name={profile?.fullname || user} size="h-20 w-20 text-2xl" />
		<div class="min-w-0">
			<h1 class="truncate text-2xl font-bold">{profile?.fullname || user}</h1>
			<p class="text-gray-500">
				@{user}
				{#if typeof profile?.numFollowers === 'number'}
					<span class="text-gray-300 dark:text-gray-600">&middot;</span>
					{m.author_followers({ count: formatCompact(profile.numFollowers) })}
				{/if}
			</p>
			{#if profile?.orgs?.length}
				<ul class="mt-2 flex flex-wrap gap-1" aria-label={m.author_orgs()}>
					{#each profile.orgs as org (org.name)}
						<li>
							<a href="/{encodeURIComponent(org.name)}" title={org.fullname} class="block">
								<Avatar
									src={org.avatarUrl}
									name={org.fullname || org.name}
									size="h-7 w-7 text-xs"
								/>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</header>

<div class="container space-y-10 py-8">
	{#if overview.error && !notFound}
		<LoadError error={overview.error} what={m.author_profile()} onretry={() => overview.retry()} />
	{/if}
	{#each sections as section (section.type)}
		{@const count = countOf(section)}
		<section aria-labelledby="author-{section.type}">
			<h2 id="author-{section.type}" class="mb-4 flex items-center gap-2 text-lg font-semibold">
				<section.icon size={18} class="text-gray-400" aria-hidden="true" />
				{section.label()}
				{#if count !== null}<span class="font-normal text-gray-400">{count}</span>{/if}
				<a
					href="{listPagePath(section.type)}?{new URLSearchParams({ author: user })}"
					class="ml-auto text-sm font-normal text-gray-500 hover:underline"
				>
					{m.list_browse_all({ what: section.label() })} &rarr;
				</a>
			</h2>
			{#if section.repos.pending}
				<ul
					class="grid grid-cols-1 gap-3 xl:grid-cols-2"
					aria-busy="true"
					aria-label={m.list_loading()}
				>
					{#each { length: 2 }, i (i)}
						<li class="overview-card h-12 animate-pulse bg-gray-50 dark:bg-gray-900"></li>
					{/each}
				</ul>
			{:else if section.repos.error}
				<LoadError
					error={section.repos.error}
					what={section.label()}
					onretry={() => section.repos.retry()}
				/>
			{:else if !section.repos.data?.items.length}
				<p class="text-sm text-gray-500">{m.author_none({ what: section.label() })}</p>
			{:else}
				<RepoGrid type={section.type} items={section.repos.data.items} />
			{/if}
		</section>
	{/each}
</div>
