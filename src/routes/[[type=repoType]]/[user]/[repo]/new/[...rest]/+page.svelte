<script lang="ts">
	import { page } from '$app/state';
	import { hub } from '$lib/auth.svelte';
	import BranchRequired from '$lib/components/BranchRequired.svelte';
	import FileBreadcrumb from '$lib/components/FileBreadcrumb.svelte';
	import FileEditor from '$lib/components/FileEditor.svelte';
	import RequireAuth from '$lib/components/RequireAuth.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import { splitTarget, useRepo } from '$lib/repo/context.svelte';

	const repo = useRepo();
	// The url tail is the branch plus an optional folder the new file goes into.
	const target = $derived(splitTarget(repo, page.params.rest ?? ''));
	const branches = $derived(repo.refs.data?.branches ?? []);
	const onBranch = $derived(!!target && branches.some((b) => b.name === target.rev));

	const tip = createQuery(async (signal) =>
		target && onBranch ? hub.info(repo.type, repo.id, { revision: target.rev }, { signal }) : null
	);
</script>

<svelte:head>
	<title>{m.new_file_title()} · {repo.id} &ndash; HuggingFox</title>
</svelte:head>

<RequireAuth>
	{#if !target}
		<div class="h-8 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true"></div>
	{:else}
		<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
			<h1 class="text-lg font-semibold">{m.new_file_title()}</h1>
			<FileBreadcrumb type={repo.type} id={repo.id} rev={target.rev} path={target.path} />
		</div>
		{#if !onBranch}
			<BranchRequired action="new" type={repo.type} id={repo.id} path={target.path} {branches} />
		{:else}
			{#key `${target.rev}:${target.path}`}
				<FileEditor
					mode="new"
					type={repo.type}
					id={repo.id}
					branch={target.rev}
					dir={target.path}
					{tip}
				/>
			{/key}
		{/if}
	{/if}
</RequireAuth>
