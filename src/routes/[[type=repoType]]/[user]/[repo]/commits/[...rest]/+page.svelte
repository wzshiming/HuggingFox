<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FolderTree from '@lucide/svelte/icons/folder-tree';
	import Lock from '@lucide/svelte/icons/lock';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { commitPagePath, commitsPagePath, treePagePath } from '$lib/api/url';
	import { auth, hub } from '$lib/auth.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import LoadError from '$lib/components/LoadError.svelte';
	import RefSelector from '$lib/components/RefSelector.svelte';
	import { formatDate, formatRelative } from '$lib/format';
	import { commitsPageOf, groupByDay, shortSha, splitMessage } from '$lib/history/commits';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import { splitTarget, useRepo } from '$lib/repo/context.svelte';

	const repo = useRepo();
	const target = $derived(splitTarget(repo, page.params.rest ?? ''));
	const p = $derived(commitsPageOf(page.url.searchParams));
	const limit = 20;

	const commits = createQuery(async (signal) =>
		target ? hub.commits(repo.type, repo.id, target.rev, { p, limit }, { signal }) : null
	);
	const groups = $derived(
		commits.data ? groupByDay(commits.data.items, document.documentElement.lang || 'en') : []
	);
	const total = $derived(commits.data?.total ?? null);
	// Link/total decide; a hub sending neither still gets a next page while pages come back full.
	const hasNext = $derived.by(() => {
		const data = commits.data;
		if (!data) return false;
		if (data.next !== null) return true;
		if (total !== null) return (p + 1) * limit < total;
		return data.items.length === limit;
	});
	const pageHref = (n: number) =>
		target ? commitsPagePath(repo.type, repo.id, target.rev) + (n > 0 ? `?p=${n}` : '') : '';
	const status = $derived(commits.error instanceof ApiError ? commits.error.status : null);
</script>

<svelte:head>
	<title>{m.files_history()} &middot; {repo.id} at {target?.rev ?? ''} &ndash; HuggingFox</title>
</svelte:head>

{#if !target}
	<div class="h-8 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true"></div>
{:else}
	<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
		<RefSelector
			refs={repo.refs.data}
			current={target.rev}
			href={(ref) => commitsPagePath(repo.type, repo.id, ref)}
		/>
		<h2 class="text-smd font-semibold">
			{total === null
				? m.files_history()
				: m.files_history_count({ count: total.toLocaleString() })}
		</h2>
	</div>

	{#if commits.pending}
		<div class="space-y-3" aria-busy="true" aria-label={m.list_loading()}>
			{#each { length: 6 }, i (i)}
				<div class="h-12 animate-pulse rounded bg-gray-50 dark:bg-gray-900"></div>
			{/each}
		</div>
	{:else if status === 404}
		<p
			class="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700"
		>
			{m.files_not_found()}
		</p>
	{:else if status === 401 || status === 403}
		<div class="py-12 text-center text-gray-500">
			<Lock size={32} class="mx-auto text-gray-300 dark:text-gray-700" aria-hidden="true" />
			<p class="mt-3">{m.files_restricted()}</p>
			{#if !auth.user}<a href="/login" class="mt-3 inline-block underline">{m.auth_login()}</a>{/if}
		</div>
	{:else if commits.error}
		<LoadError error={commits.error} what={m.files_history()} onretry={() => commits.retry()} />
	{:else if !groups.length}
		<p
			class="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700"
		>
			{m.commits_empty()}
		</p>
	{:else}
		{#each groups as group (group.day)}
			<section class="mb-6">
				<h3 class="mb-2 text-sm text-gray-500">{m.commits_on({ day: group.day })}</h3>
				<ol
					class="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700"
				>
					{#each group.items as commit (commit.id)}
						{@const { title } = splitMessage(commit)}
						<li class="flex items-start gap-3 px-3 py-2.5 text-sm">
							<div class="flex flex-none -space-x-2 pt-0.5">
								{#each (commit.authors ?? []).slice(0, 3) as author (author.user)}
									<Avatar src={author.avatar} name={author.user} size="h-6 w-6 text-[10px]" />
								{/each}
							</div>
							<div class="min-w-0 flex-1">
								<a
									href={commitPagePath(repo.type, repo.id, commit.id)}
									class="block truncate font-semibold hover:underline"
									{title}
								>
									{title || shortSha(commit.id)}
								</a>
								<p class="text-xs text-gray-500">
									{#each commit.authors ?? [] as author, i (author.user)}
										{#if i > 0},&nbsp;{/if}
										<a href="/{encodeURIComponent(author.user)}" class="hover:underline"
											>{author.user}</a
										>
									{/each}
									{#if commit.authors?.length}<span aria-hidden="true">&middot;</span>{/if}
									<time datetime={commit.date} title={formatDate(commit.date)}>
										{formatRelative(commit.date)}
									</time>
								</p>
							</div>
							<div class="flex flex-none items-center gap-1">
								<a
									href={commitPagePath(repo.type, repo.id, commit.id)}
									class="rounded-l-md border border-gray-200 px-1.5 py-0.5 font-mono text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
								>
									{shortSha(commit.id)}
								</a>
								<CopyButton text={commit.id} label={m.commits_copy_sha()} />
								<a
									href={treePagePath(repo.type, repo.id, commit.id)}
									class="hidden rounded-md border border-gray-200 p-1 text-gray-500 hover:bg-gray-50 sm:inline-flex dark:border-gray-700 dark:hover:bg-gray-800"
									aria-label={m.commits_browse()}
									title={m.commits_browse()}
								>
									<FolderTree size={14} aria-hidden="true" />
								</a>
							</div>
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	{/if}

	{#if p > 0 || hasNext}
		<nav class="mt-6 flex justify-center gap-3 text-sm" aria-label={m.pagination_label()}>
			{#if p > 0}
				<a
					href={pageHref(p - 1)}
					rel="prev"
					class="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
				>
					<ChevronLeft size={14} aria-hidden="true" />{m.pagination_previous()}
				</a>
			{/if}
			{#if hasNext}
				<a
					href={pageHref(p + 1)}
					rel="next"
					class="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
				>
					{m.pagination_next()}<ChevronRight size={14} aria-hidden="true" />
				</a>
			{/if}
		</nav>
	{/if}
{/if}
