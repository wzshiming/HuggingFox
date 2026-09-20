<script lang="ts">
	import { page } from '$app/state';
	import { auth, hub } from '$lib/auth.svelte';
	import BranchRequired from '$lib/components/BranchRequired.svelte';
	import FileBreadcrumb from '$lib/components/FileBreadcrumb.svelte';
	import FileEditor from '$lib/components/FileEditor.svelte';
	import LoadError from '$lib/components/LoadError.svelte';
	import RequireAuth from '$lib/components/RequireAuth.svelte';
	import { looksBinary } from '$lib/files/kind';
	import { formatBytes } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import { splitTarget, useRepo } from '$lib/repo/context.svelte';

	const repo = useRepo();
	const target = $derived(splitTarget(repo, page.params.rest ?? ''));
	const branches = $derived(repo.refs.data?.branches ?? []);
	const onBranch = $derived(!!target && branches.some((b) => b.name === target.rev));
	// Loads wait for a verified sign-in so a sign-out never refetches the file anonymously.
	const ready = $derived(!!auth.user && !!target && onBranch);
	const MAX_TEXT = 2 * 1024 * 1024;

	// One snapshot: the branch tip first, then the text at that exact commit, so the parent guard matches the content.
	const base = createQuery(async (signal) => {
		if (!ready || !target) return null;
		const info = await hub.info(repo.type, repo.id, { revision: target.rev }, { signal });
		const file = await hub.text(
			repo.type,
			repo.id,
			info.sha ?? target.rev,
			target.path,
			{ maxBytes: MAX_TEXT },
			{ signal }
		);
		return { sha: info.sha, ...file };
	});
</script>

<svelte:head>
	<title>{target ? m.edit_title({ path: target.path }) : repo.id} &ndash; HuggingFox</title>
</svelte:head>

<RequireAuth>
	{#if !target}
		<div class="h-8 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true"></div>
	{:else}
		<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
			<h1 class="text-lg font-semibold">{m.edit_title({ path: target.path })}</h1>
			<FileBreadcrumb type={repo.type} id={repo.id} rev={target.rev} path={target.path} />
		</div>
		{#if !onBranch}
			<BranchRequired action="edit" type={repo.type} id={repo.id} path={target.path} {branches} />
		{:else if base.pending}
			<div class="h-64 animate-pulse rounded-lg bg-gray-50 dark:bg-gray-900" aria-busy="true"></div>
		{:else if base.error}
			<LoadError error={base.error} what={target.path} onretry={() => base.retry()} />
		{:else if base.data?.truncated}
			<p
				role="alert"
				class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900"
			>
				{m.edit_too_large({ limit: formatBytes(MAX_TEXT) })}
			</p>
		{:else if base.data && looksBinary(base.data.text)}
			<p
				role="alert"
				class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900"
			>
				{m.edit_binary()}
			</p>
		{:else if base.data}
			{#key `${target.rev}:${target.path}:${base.data.sha ?? ''}`}
				<FileEditor
					mode="edit"
					type={repo.type}
					id={repo.id}
					branch={target.rev}
					path={target.path}
					text={base.data.text}
					tip={base}
				/>
			{/key}
		{/if}
	{/if}
</RequireAuth>
