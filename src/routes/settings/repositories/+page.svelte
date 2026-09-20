<script lang="ts">
	import Box from '@lucide/svelte/icons/box';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import Table from '@lucide/svelte/icons/table';
	import { repoPagePath, type RepoType } from '$lib/api/url';
	import { auth, hub } from '$lib/auth.svelte';
	import LoadError from '$lib/components/LoadError.svelte';
	import RequireAuth from '$lib/components/RequireAuth.svelte';
	import { formatRelative } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';

	const owners = $derived([
		...(auth.user?.name ? [auth.user.name] : []),
		...(auth.user?.orgs ?? []).map((org) => org.name)
	]);
	let owner = $state('');
	$effect(() => {
		if (!owners.includes(owner)) owner = owners[0] ?? '';
	});

	const create = [
		{ href: '/new', label: m.menu_new_model },
		{ href: '/new-dataset', label: m.menu_new_dataset },
		{ href: '/new-space', label: m.menu_new_space }
	];
	// Lists load only once the owner is known, i.e. after whoami validated the token.
	const sections = [
		{ type: 'model' as RepoType, label: m.nav_models, icon: Box },
		{ type: 'dataset' as RepoType, label: m.nav_datasets, icon: Table },
		{ type: 'space' as RepoType, label: m.nav_spaces, icon: LayoutGrid }
	].map((section) => ({
		...section,
		repos: createQuery(async (signal) =>
			owner
				? hub.listRepos(
						section.type,
						{ author: owner, sort: 'lastModified', direction: -1, limit: 100 },
						{ signal }
					)
				: null
		)
	}));
</script>

<svelte:head>
	<title>{m.menu_my_repos()} &ndash; HuggingFox</title>
</svelte:head>

<RequireAuth>
	<div class="container space-y-8 py-8">
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold">{m.menu_my_repos()}</h1>
			<label class="ml-auto flex items-center gap-2 text-sm">
				<span class="font-semibold">{m.repo_owner()}</span>
				<select class="form-input-alt h-8 px-2" bind:value={owner}>
					{#each owners as candidate (candidate)}
						<option value={candidate}>{candidate}</option>
					{/each}
				</select>
			</label>
		</div>
		<ul class="flex flex-wrap gap-2">
			{#each create as item (item.href)}
				<li>
					<a
						href={item.href}
						class="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
					>
						<Plus size={14} aria-hidden="true" />
						{item.label()}
					</a>
				</li>
			{/each}
		</ul>
		{#each sections as section (section.type)}
			<section aria-labelledby="my-{section.type}">
				<h2 id="my-{section.type}" class="mb-3 flex items-center gap-2 text-lg font-semibold">
					<section.icon size={18} class="text-gray-400" aria-hidden="true" />
					{section.label()}
					{#if section.repos.data}
						<span class="font-normal text-gray-400">{section.repos.data.items.length}</span>
					{/if}
				</h2>
				{#if section.repos.pending}
					<ul class="space-y-2" aria-busy="true" aria-label={m.list_loading()}>
						{#each { length: 2 }, i (i)}
							<li class="overview-card h-11 animate-pulse bg-gray-50 dark:bg-gray-900"></li>
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
					<ul
						class="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700"
					>
						{#each section.repos.data.items as repo (repo.id)}
							{@const href = repoPagePath(section.type, repo.id)}
							<li class="flex items-center gap-3 px-3 py-2 text-sm">
								<a {href} class="min-w-0 flex-1 truncate font-mono font-semibold hover:underline">
									{repo.id}
								</a>
								{#if repo.lastModified}
									<span class="hidden text-gray-500 sm:block">
										{m.repo_updated({ when: formatRelative(repo.lastModified) })}
									</span>
								{/if}
								<a
									href="{href}/settings"
									class="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
									aria-label="{m.tab_settings()}: {repo.id}"
								>
									<Settings size={12} aria-hidden="true" />
									{m.tab_settings()}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>
</RequireAuth>
