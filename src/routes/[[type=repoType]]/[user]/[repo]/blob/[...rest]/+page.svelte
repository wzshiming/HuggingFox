<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import History from '@lucide/svelte/icons/history';
	import Lock from '@lucide/svelte/icons/lock';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import type { TreeEntry } from '$lib/api/types';
	import {
		blobPagePath,
		commitsPagePath,
		downloadPath,
		fileActionPath,
		resolvePath
	} from '$lib/api/url';
	import { auth, hub } from '$lib/auth.svelte';
	import CodeView from '$lib/components/CodeView.svelte';
	import CommitLine from '$lib/components/CommitLine.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import FileBreadcrumb from '$lib/components/FileBreadcrumb.svelte';
	import ImageView from '$lib/components/ImageView.svelte';
	import LoadError from '$lib/components/LoadError.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import RefSelector from '$lib/components/RefSelector.svelte';
	import TensorView from '$lib/components/TensorView.svelte';
	import { fileKind, looksBinary, parentOf } from '$lib/files/kind';
	import { formatBytes } from '$lib/format';
	import { splitFrontmatter } from '$lib/markdown/frontmatter';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import { splitTarget, useRepo } from '$lib/repo/context.svelte';

	const repo = useRepo();
	const target = $derived(splitTarget(repo, page.params.rest ?? ''));
	const kind = $derived(target ? fileKind(target.path) : null);
	const textual = $derived(
		kind?.kind === 'markdown' || kind?.kind === 'text' || kind?.kind === 'unknown'
	);
	const MAX_TEXT = 2 * 1024 * 1024;

	// Size, oid, LFS and last commit come from the parent listing; paths-info only covers a folder too big for one page.
	const meta = createQuery(async (signal): Promise<TreeEntry | null> => {
		if (!target?.path) return null;
		const dir = parentOf(target.path) ?? '';
		const listing = await hub.tree(
			repo.type,
			repo.id,
			target.rev,
			dir,
			{ expand: true },
			{ signal }
		);
		const hit = listing.items.find((e) => e.path === target.path);
		if (hit || !listing.next) return hit ?? null;
		try {
			const infos = await hub.pathsInfo(
				repo.type,
				repo.id,
				target.rev,
				[target.path],
				{ expand: true },
				{ signal }
			);
			return infos.find((e) => e.path === target.path) ?? null;
		} catch (error) {
			if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return null;
			throw error;
		}
	});
	const file = createQuery(async (signal) =>
		target?.path && textual
			? hub.text(repo.type, repo.id, target.rev, target.path, { maxBytes: MAX_TEXT }, { signal })
			: null
	);

	const entry = $derived(meta.data);
	const binary = $derived(
		kind?.kind === 'binary' ||
			(kind?.kind === 'unknown' && !!file.data && looksBinary(file.data.text))
	);
	const status = $derived(file.error instanceof ApiError ? file.error.status : null);
	const metaStatus = $derived(meta.error instanceof ApiError ? meta.error.status : null);
	const missing = $derived(
		status === 404 ||
			(kind?.kind === 'binary' &&
				!meta.pending &&
				(metaStatus === 404 || (!meta.error && entry === null)))
	);
	const name = $derived(target ? target.path.slice(target.path.lastIndexOf('/') + 1) : '');
	const card = $derived(
		kind?.kind === 'markdown' && file.data ? splitFrontmatter(file.data.text) : null
	);
	const size = $derived(entry?.lfs?.size ?? entry?.size ?? file.data?.size ?? null);
	const privateNote = $derived(
		!!auth.token && !!(repo.info.data?.private || repo.info.data?.gated)
	);

	let mode = $state<'preview' | 'code'>('preview');
	const modes = [
		{ value: 'preview', label: m.blob_preview },
		{ value: 'code', label: m.blob_code }
	] as const;
	$effect(() => {
		void target?.path;
		mode = 'preview';
	});
</script>

<svelte:head>
	<title
		>{target ? `${target.path} · ${repo.id} at ${target.rev}` : repo.id} &ndash; HuggingFox</title
	>
</svelte:head>

{#if !target || !kind}
	<div class="h-8 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true"></div>
{:else}
	<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
		<RefSelector
			refs={repo.refs.data}
			current={target.rev}
			href={(ref) => blobPagePath(repo.type, repo.id, ref, target.path)}
		/>
		<FileBreadcrumb type={repo.type} id={repo.id} rev={target.rev} path={target.path} />
	</div>

	<div class="rounded-lg border border-gray-200 dark:border-gray-700">
		{#if entry?.lastCommit}
			<CommitLine commit={entry.lastCommit} type={repo.type} id={repo.id} />
		{/if}
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
		>
			{#if kind.kind === 'markdown'}
				<div
					role="tablist"
					class="flex rounded-lg border border-gray-200 text-xs dark:border-gray-700"
				>
					{#each modes as tab (tab.value)}
						<button
							type="button"
							role="tab"
							aria-selected={mode === tab.value}
							class="px-2.5 py-1 first:rounded-l-lg last:rounded-r-lg {mode === tab.value
								? 'bg-gray-100 font-semibold dark:bg-gray-800'
								: 'text-gray-500'}"
							onclick={() => (mode = tab.value)}
						>
							{tab.label()}
						</button>
					{/each}
				</div>
			{/if}
			<span class="text-gray-500">
				{#if entry?.lfs}<span
						class="mr-1 rounded border border-gray-200 px-1 text-[10px] font-semibold dark:border-gray-700"
						>LFS</span
					>{/if}
				{#if size !== null}{formatBytes(size)}{/if}
			</span>
			{#if entry?.oid}
				<span class="hidden items-center gap-1 text-gray-500 sm:flex">
					{m.blob_oid()}
					<code class="font-mono text-xs">{entry.oid.slice(0, 12)}</code>
					<CopyButton text={entry.oid} label={m.blob_oid()} />
				</span>
			{/if}
			<span class="ml-auto flex items-center gap-1">
				<a
					href={resolvePath(repo.type, repo.id, target.rev, target.path)}
					class="rounded-md border border-gray-200 px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
					>{m.files_raw()}</a
				>
				<a
					href={downloadPath(repo.type, repo.id, target.rev, target.path)}
					class="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
					><Download size={12} aria-hidden="true" />{m.files_download()}</a
				>
				<a
					href={commitsPagePath(repo.type, repo.id, target.rev)}
					class="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
					><History size={12} aria-hidden="true" />{m.files_history()}</a
				>
				{#if auth.user}
					{#if textual && !binary}
						<a
							href={fileActionPath('edit', repo.type, repo.id, target.rev, target.path)}
							class="flex items-center rounded-md border border-gray-200 px-1.5 py-0.5 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
							aria-label={m.blob_edit()}
							title={m.blob_edit()}
						>
							<Pencil size={12} aria-hidden="true" />
						</a>
					{/if}
					<a
						href={fileActionPath('delete', repo.type, repo.id, target.rev, target.path)}
						class="flex items-center rounded-md border border-gray-200 px-1.5 py-0.5 text-gray-600 hover:bg-gray-50 hover:text-red-600 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						aria-label={m.blob_delete()}
						title={m.blob_delete()}
					>
						<Trash size={12} aria-hidden="true" />
					</a>
				{/if}
			</span>
		</div>
		{#if privateNote}
			<p class="border-b border-gray-200 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700">
				{m.files_download_private()}
			</p>
		{/if}

		{#if missing}
			<p class="px-3 py-8 text-center text-gray-500">{m.files_not_found()}</p>
		{:else if status === 401 || status === 403}
			<div class="py-10 text-center text-gray-500">
				<Lock size={28} class="mx-auto text-gray-300 dark:text-gray-700" aria-hidden="true" />
				<p class="mt-2">{m.files_restricted()}</p>
				{#if !auth.user}<a href="/login" class="mt-2 inline-block underline">{m.auth_login()}</a
					>{/if}
			</div>
		{:else if kind.kind === 'image'}
			<ImageView
				target={{ type: repo.type, id: repo.id, rev: target.rev, path: target.path }}
				mime={kind.mime}
			/>
		{:else if kind.kind === 'safetensors' || kind.kind === 'gguf'}
			<TensorView
				target={{ type: repo.type, id: repo.id, rev: target.rev, path: target.path }}
				format={kind.kind}
			/>
		{:else if binary}
			<div class="px-3 py-10 text-center text-gray-500" data-testid="binary-fallback">
				<p>{m.blob_binary()}</p>
				<a
					href={downloadPath(repo.type, repo.id, target.rev, target.path)}
					class="mt-3 inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black dark:bg-gray-200 dark:text-gray-900"
				>
					<Download size={14} aria-hidden="true" />
					{m.files_download()}{#if size !== null}&nbsp;({formatBytes(size)}){/if}
				</a>
			</div>
		{:else if file.pending}
			<div class="space-y-2 p-4" aria-busy="true" aria-label={m.list_loading()}>
				{#each [70, 100, 40, 90] as width, i (i)}
					<div
						class="h-3 animate-pulse rounded bg-gray-100 dark:bg-gray-800"
						style:width="{width}%"
					></div>
				{/each}
			</div>
		{:else if file.error}
			<div class="p-4">
				<LoadError error={file.error} what={name} onretry={() => file.retry()} />
			</div>
		{:else if file.data}
			{#if file.data.truncated}
				<p
					role="status"
					class="border-b border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200"
				>
					{file.data.text
						? m.blob_truncated({ limit: formatBytes(MAX_TEXT) })
						: m.blob_too_large({
								size: file.data.size === null ? '?' : formatBytes(file.data.size),
								limit: formatBytes(MAX_TEXT)
							})}
				</p>
			{/if}
			{#if !file.data.text}
				{#if !file.data.truncated}<p class="px-3 py-8 text-center text-gray-500">
						{m.blob_empty()}
					</p>{/if}
			{:else if card && mode === 'preview'}
				<div class="p-4 sm:p-6">
					<Markdown
						source={card.body}
						target={{
							type: repo.type,
							id: repo.id,
							rev: target.rev,
							dir: parentOf(target.path) ?? ''
						}}
					/>
				</div>
			{:else}
				<CodeView text={file.data.text} language={'language' in kind ? kind.language : null} />
			{/if}
		{/if}
	</div>

	{#if entry?.lfs || entry?.xetHash}
		<dl
			class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
			aria-label={m.blob_lfs_details()}
		>
			{#if entry.lfs}
				<dt class="text-gray-500">{m.blob_lfs_sha()}</dt>
				<dd class="flex items-center gap-1 font-mono text-xs break-all">
					{entry.lfs.oid}<CopyButton text={entry.lfs.oid} />
				</dd>
				<dt class="text-gray-500">{m.blob_lfs_pointer()}</dt>
				<dd>{entry.lfs.pointerSize ? formatBytes(entry.lfs.pointerSize) : m.stat_unavailable()}</dd>
				<dt class="text-gray-500">{m.blob_lfs_remote()}</dt>
				<dd>{formatBytes(entry.lfs.size)}</dd>
			{/if}
			{#if entry.xetHash}
				<dt class="text-gray-500">{m.blob_xet()}</dt>
				<dd class="font-mono text-xs break-all">{entry.xetHash}</dd>
			{/if}
		</dl>
	{/if}
{/if}
