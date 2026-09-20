<script lang="ts">
	import FolderTree from '@lucide/svelte/icons/folder-tree';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { treePagePath } from '$lib/api/url';
	import { hub } from '$lib/auth.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import DiffFile from '$lib/components/DiffFile.svelte';
	import LoadError from '$lib/components/LoadError.svelte';
	import { formatBytes, formatDate } from '$lib/format';
	import { shortSha, splitMessage } from '$lib/history/commits';
	import { parsePatch } from '$lib/history/diff';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import { useRepo } from '$lib/repo/context.svelte';

	const repo = useRepo();
	const sha = $derived(page.params.sha ?? '');
	const MAX_PATCH = 2 * 1024 * 1024;

	// The commit itself is the newest entry of its own history; the total tells a root commit apart.
	const meta = createQuery((signal) =>
		hub.commits(repo.type, repo.id, sha, { limit: 1 }, { signal })
	);
	// First-parent compare via the `^` expression; no parent sha is ever guessed from the log.
	const diff = createQuery((signal) =>
		hub.patch(repo.type, repo.id, `${sha}^`, sha, { maxBytes: MAX_PATCH }, { signal })
	);

	const commit = $derived(meta.data?.items[0] ?? null);
	const message = $derived(commit ? splitMessage(commit) : null);
	const patch = $derived(diff.data?.text ? parsePatch(diff.data.text) : null);
	const diffStatus = $derived(diff.error instanceof ApiError ? diff.error.status : null);
	const root = $derived(meta.data?.total === 1);
	const notFound = $derived(
		(meta.error instanceof ApiError && meta.error.status === 404) || (meta.data && !commit)
	);
</script>

<svelte:head>
	<title>{m.commit_title({ sha: shortSha(sha) })} &middot; {repo.id} &ndash; HuggingFox</title>
</svelte:head>

{#if meta.pending}
	<div class="space-y-3" aria-busy="true" aria-label={m.list_loading()}>
		<div class="h-6 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800"></div>
		<div class="h-4 w-1/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800"></div>
	</div>
{:else if notFound}
	<p
		class="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700"
	>
		{m.commit_not_found({ sha })}
	</p>
{:else if meta.error}
	<LoadError error={meta.error} what={shortSha(sha)} onretry={() => meta.retry()} />
{:else if commit && message}
	<article>
		<header class="rounded-lg border border-gray-200 dark:border-gray-700">
			<div class="flex flex-wrap items-start gap-3 px-4 py-3">
				<div class="min-w-0 flex-1">
					<h2 class="text-lg font-semibold break-words">{message.title || shortSha(commit.id)}</h2>
					{#if message.body}
						<pre
							class="mt-2 font-sans text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-300">{message.body}</pre>
					{/if}
				</div>
				<a
					href={treePagePath(repo.type, repo.id, commit.id)}
					class="flex flex-none items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
				>
					<FolderTree size={14} aria-hidden="true" />
					{m.commits_browse()}
				</a>
			</div>
			<div
				class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-200 bg-gray-50 px-4 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
			>
				{#each commit.authors ?? [] as author (author.user)}
					<span class="flex items-center gap-1.5">
						<Avatar src={author.avatar} name={author.user} size="h-5 w-5 text-[10px]" />
						<a href="/{encodeURIComponent(author.user)}" class="font-semibold hover:underline"
							>{author.user}</a
						>
					</span>
				{/each}
				<time datetime={commit.date} class="text-gray-500">{formatDate(commit.date)}</time>
				<span
					class="ml-auto flex items-center gap-1 font-mono text-xs text-gray-600 dark:text-gray-300"
				>
					<span class="break-all" data-testid="commit-sha">{commit.id}</span>
					<CopyButton text={commit.id} label={m.commits_copy_sha()} />
				</span>
			</div>
		</header>

		<section
			class="mt-6"
			aria-label={m.commit_files_changed({ count: String(patch?.files.length ?? 0) })}
		>
			{#if diff.pending}
				<div class="space-y-2" aria-busy="true" aria-label={m.list_loading()}>
					{#each { length: 4 }, i (i)}
						<div class="h-8 animate-pulse rounded bg-gray-50 dark:bg-gray-900"></div>
					{/each}
				</div>
			{:else if diffStatus === 404}
				<p
					class="rounded-lg border border-dashed border-gray-300 p-6 text-center text-gray-500 dark:border-gray-700"
					role="status"
				>
					{root
						? m.commit_root()
						: m.commit_diff_unavailable({ detail: (diff.error as ApiError).detail })}
				</p>
			{:else if diff.error}
				<LoadError error={diff.error} what={shortSha(sha)} onretry={() => diff.retry()} />
			{:else if diff.data}
				{#if diff.data.truncated}
					<p
						role="status"
						class="mb-3 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200"
					>
						{m.commit_patch_truncated({ limit: formatBytes(MAX_PATCH) })}
					</p>
				{/if}
				{#if !patch?.files.length}
					{#if !diff.data.truncated}
						<p
							class="rounded-lg border border-dashed border-gray-300 p-6 text-center text-gray-500 dark:border-gray-700"
							role="status"
						>
							{m.commit_no_changes()}
						</p>
					{/if}
				{:else}
					{#if !diff.data.truncated}
						<p class="mb-3 text-sm text-gray-600 dark:text-gray-400" data-testid="diff-stats">
							{m.commit_files_changed({ count: patch.files.length.toLocaleString() })}
							<span class="ml-2 font-mono text-green-700 dark:text-green-400"
								>+{patch.additions}</span
							>
							<span class="font-mono text-red-700 dark:text-red-400">&minus;{patch.deletions}</span>
						</p>
					{/if}
					<div class="space-y-4">
						{#each patch.files as file (file.oldPath ? `${file.oldPath}→${file.path}` : file.path)}
							<DiffFile {file} open={file.additions + file.deletions <= 400} />
						{/each}
					</div>
				{/if}
			{/if}
		</section>
	</article>
{/if}
