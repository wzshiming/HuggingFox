<script lang="ts">
	import CornerLeftUp from '@lucide/svelte/icons/corner-left-up';
	import Download from '@lucide/svelte/icons/download';
	import FileIcon from '@lucide/svelte/icons/file';
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import Folder from '@lucide/svelte/icons/folder';
	import History from '@lucide/svelte/icons/history';
	import Lock from '@lucide/svelte/icons/lock';
	import Plus from '@lucide/svelte/icons/plus';
	import Upload from '@lucide/svelte/icons/upload';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import type { Page, TreeEntry } from '$lib/api/types';
	import {
		blobPagePath,
		commitsPagePath,
		downloadPath,
		fileActionPath,
		treePagePath
	} from '$lib/api/url';
	import { auth, hub } from '$lib/auth.svelte';
	import CommitLine from '$lib/components/CommitLine.svelte';
	import FileBreadcrumb from '$lib/components/FileBreadcrumb.svelte';
	import LoadError from '$lib/components/LoadError.svelte';
	import RefSelector from '$lib/components/RefSelector.svelte';
	import { parentOf, sortEntries } from '$lib/files/kind';
	import { formatBytes, formatDate, formatRelative } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import { splitTarget, useRepo } from '$lib/repo/context.svelte';

	const repo = useRepo();
	const target = $derived(splitTarget(repo, page.params.rest ?? ''));
	const MAX_PAGES = 40;

	const tree = createQuery(async (signal) =>
		target
			? hub.tree(repo.type, repo.id, target.rev, target.path, { expand: true }, { signal })
			: null
	);
	// One request gives the newest commit for the bar and the total for the history link.
	const latest = createQuery(async (signal) =>
		target ? hub.commits(repo.type, repo.id, target.rev, { limit: 1 }, { signal }) : null
	);

	let extra = $state.raw<Page<TreeEntry>[]>([]);
	let loading = $state(false);
	let moreError = $state<unknown>();
	let controller: AbortController | undefined;
	// A new first page (ref, path or session change) discards everything loaded after the old one.
	$effect(() => {
		void tree.data;
		controller?.abort();
		extra = [];
		loading = false;
		moreError = undefined;
	});
	const pages = $derived(tree.data ? [tree.data, ...extra] : []);
	const items = $derived(sortEntries(pages.flatMap((p) => p.items)));
	const next = $derived(pages.at(-1)?.next ?? null);
	const capped = $derived(next !== null && pages.length >= MAX_PAGES);

	async function loadMore() {
		if (!next || capped || loading) return;
		const mine = new AbortController();
		controller = mine;
		loading = true;
		moreError = undefined;
		try {
			const more = await hub.page<TreeEntry>(next, { signal: mine.signal });
			if (!mine.signal.aborted) extra = [...extra, more];
		} catch (error) {
			if (!mine.signal.aborted) moreError = error;
		} finally {
			if (!mine.signal.aborted) loading = false;
		}
	}

	const status = $derived(tree.error instanceof ApiError ? tree.error.status : null);
	const history = $derived(latest.data?.total ?? null);
	const name = (path: string) => path.slice(path.lastIndexOf('/') + 1);

	let addOpen = $state(false);
	let addMenu = $state<HTMLElement>();
	$effect(() => {
		void page.url.pathname;
		addOpen = false;
	});
</script>

<svelte:head>
	<title
		>{repo.id}{target?.path ? ` / ${target.path}` : ''}{target ? ` at ${target.rev}` : ''} &ndash; HuggingFox</title
	>
</svelte:head>

{#if !target}
	<div class="h-8 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true"></div>
{:else}
	<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
		<RefSelector
			refs={repo.refs.data}
			current={target.rev}
			href={(ref) => treePagePath(repo.type, repo.id, ref, target.path)}
		/>
		<FileBreadcrumb type={repo.type} id={repo.id} rev={target.rev} path={target.path} />
		<a
			href={commitsPagePath(repo.type, repo.id, target.rev)}
			class="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-sm hover:bg-gray-50 sm:ml-auto dark:border-gray-700 dark:hover:bg-gray-800"
		>
			<History size={14} aria-hidden="true" />
			{history === null
				? m.files_history()
				: m.files_history_count({ count: history.toLocaleString() })}
		</a>
		{#if auth.user}
			<div
				class="relative"
				bind:this={addMenu}
				onfocusout={(e) => {
					if (!addMenu?.contains(e.relatedTarget as Node | null)) addOpen = false;
				}}
			>
				<button
					type="button"
					class="flex items-center gap-1 rounded-lg bg-gray-900 px-2.5 py-1 text-sm font-semibold text-white hover:bg-black dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
					aria-haspopup="menu"
					aria-expanded={addOpen}
					onclick={() => (addOpen = !addOpen)}
					onkeydown={(e) => e.key === 'Escape' && (addOpen = false)}
				>
					<Plus size={14} aria-hidden="true" />
					{m.files_add()}
				</button>
				{#if addOpen}
					<div
						role="menu"
						class="absolute right-0 z-40 mt-1 w-52 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-925"
					>
						<a
							role="menuitem"
							href={fileActionPath('upload', repo.type, repo.id, target.rev, target.path)}
							class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
						>
							<Upload size={14} class="text-gray-400" aria-hidden="true" />
							{m.files_upload()}
						</a>
						<a
							role="menuitem"
							href={fileActionPath('new', repo.type, repo.id, target.rev, target.path)}
							class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
						>
							<FilePlus size={14} class="text-gray-400" aria-hidden="true" />
							{m.files_new()}
						</a>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if tree.pending}
		<div class="space-y-2" aria-busy="true" aria-label={m.list_loading()}>
			{#each { length: 6 }, i (i)}
				<div class="h-9 animate-pulse rounded bg-gray-50 dark:bg-gray-900"></div>
			{/each}
		</div>
	{:else if status === 404}
		<div
			class="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700"
		>
			<p>{m.files_not_found()}</p>
			<a href={treePagePath(repo.type, repo.id, target.rev)} class="mt-2 inline-block underline">
				{repo.id.slice(repo.id.indexOf('/') + 1)}
			</a>
		</div>
	{:else if status === 401 || status === 403}
		<div class="py-12 text-center text-gray-500">
			<Lock size={32} class="mx-auto text-gray-300 dark:text-gray-700" aria-hidden="true" />
			<p class="mt-3">{m.files_restricted()}</p>
			{#if !auth.user}<a href="/login" class="mt-3 inline-block underline">{m.auth_login()}</a>{/if}
		</div>
	{:else if tree.error}
		<LoadError error={tree.error} what={target.path || repo.id} onretry={() => tree.retry()} />
	{:else}
		<div class="rounded-lg border border-gray-200 dark:border-gray-700">
			{#if latest.data?.items[0]}
				<CommitLine commit={latest.data.items[0]} type={repo.type} id={repo.id} />
			{/if}
			<table class="w-full text-sm" aria-label={m.files_table()}>
				<thead class="sr-only">
					<tr>
						<th>{m.files_col_name()}</th>
						<th>{m.files_col_size()}</th>
						<th>{m.files_col_commit()}</th>
						<th>{m.files_col_date()}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
					{#if target.path}
						<tr>
							<td colspan="4" class="px-3 py-1.5">
								<a
									href={treePagePath(repo.type, repo.id, target.rev, parentOf(target.path) ?? '')}
									class="flex items-center gap-2 text-gray-500 hover:underline"
									aria-label={m.files_parent()}
								>
									<CornerLeftUp size={14} aria-hidden="true" /><span class="font-mono">..</span>
								</a>
							</td>
						</tr>
					{/if}
					{#each items as entry (entry.path)}
						{@const dir = entry.type === 'directory'}
						{@const href = dir
							? treePagePath(repo.type, repo.id, target.rev, entry.path)
							: blobPagePath(repo.type, repo.id, target.rev, entry.path)}
						<tr class="hover:bg-gray-50 dark:hover:bg-gray-900">
							<td class="w-full max-w-0 px-3 py-1.5 md:w-1/2">
								<div class="flex min-w-0 items-center gap-2">
									{#if dir}
										<Folder
											size={16}
											class="flex-none fill-blue-200 text-blue-400 dark:fill-blue-900"
											aria-hidden="true"
										/>
									{:else}
										<FileIcon size={16} class="flex-none text-gray-400" aria-hidden="true" />
									{/if}
									<a {href} class="truncate hover:underline" class:font-semibold={dir}
										>{name(entry.path)}</a
									>
									{#if entry.lfs}
										<span
											class="flex-none rounded border border-gray-200 px-1 text-[10px] font-semibold text-gray-500 dark:border-gray-700"
											>LFS</span
										>
									{/if}
								</div>
							</td>
							<td class="px-2 py-1.5 text-right text-gray-500 whitespace-nowrap">
								{#if !dir}
									{#if typeof entry.size === 'number'}{formatBytes(entry.size)}{/if}
									<a
										href={downloadPath(repo.type, repo.id, target.rev, entry.path)}
										class="ml-1 inline-flex align-middle text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
										aria-label="{m.files_download()} {name(entry.path)}"
									>
										<Download size={14} aria-hidden="true" />
									</a>
								{/if}
							</td>
							<td
								class="hidden max-w-0 truncate px-2 py-1.5 text-gray-500 md:table-cell md:w-1/2"
								title={entry.lastCommit?.title}
							>
								{entry.lastCommit?.title ?? ''}
							</td>
							<td
								class="hidden px-3 py-1.5 text-right text-gray-500 whitespace-nowrap sm:table-cell"
							>
								{#if entry.lastCommit?.date}
									<time datetime={entry.lastCommit.date} title={formatDate(entry.lastCommit.date)}>
										{formatRelative(entry.lastCommit.date)}
									</time>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="4" class="px-3 py-8 text-center text-gray-500">{m.files_empty()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if moreError}
			<div class="mt-3">
				<LoadError error={moreError} what={target.path || repo.id} onretry={loadMore} />
			</div>
		{:else if capped}
			<p class="mt-3 text-center text-sm text-gray-500">
				{m.files_load_limit({ count: items.length.toLocaleString() })}
			</p>
		{:else if next}
			<div class="mt-3 text-center">
				<button
					type="button"
					class="rounded-full border border-gray-200 px-4 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
					disabled={loading}
					onclick={loadMore}
				>
					{loading ? m.list_loading() : m.files_load_more()}
				</button>
			</div>
		{/if}
	{/if}
{/if}
