<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createAction } from '$lib/action.svelte';
	import { blobPagePath, treePagePath } from '$lib/api/url';
	import { commitFiles } from '$lib/api/write';
	import { hub } from '$lib/auth.svelte';
	import BranchRequired from '$lib/components/BranchRequired.svelte';
	import CommitFooter from '$lib/components/CommitFooter.svelte';
	import FileBreadcrumb from '$lib/components/FileBreadcrumb.svelte';
	import RequireAuth from '$lib/components/RequireAuth.svelte';
	import { parentOf } from '$lib/files/kind';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import { splitTarget, useRepo } from '$lib/repo/context.svelte';

	const repo = useRepo();
	const target = $derived(splitTarget(repo, page.params.rest ?? ''));
	const branches = $derived(repo.refs.data?.branches ?? []);
	const onBranch = $derived(!!target && branches.some((b) => b.name === target.rev));

	const tip = createQuery(async (signal) =>
		target && onBranch ? hub.info(repo.type, repo.id, { revision: target.rev }, { signal }) : null
	);

	let typed = $state('');
	let message = $state('');
	let description = $state('');
	const action = createAction();
	const placeholder = $derived(m.commit_default_delete({ path: target?.path ?? '' }));

	// The confirmation and any pending delete belong to one file on one branch; a reused route starts over.
	const key = $derived(target ? `${target.rev}:${target.path}` : null);
	$effect(() => {
		void key;
		typed = '';
		action.cancel();
		action.clear();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const parentCommit = tip.data?.sha;
		if (!target || typed !== target.path || !parentCommit) return;
		const { rev, path } = target;
		const dest = { type: repo.type, id: repo.id };
		const result = await action.run((session, signal) =>
			commitFiles(session, dest, {
				branch: rev,
				parentCommit,
				title: message.trim() || placeholder,
				description: description.trim() || undefined,
				operations: [{ path, delete: true }],
				signal
			})
		);
		if (!result) return;
		repo.refresh();
		goto(treePagePath(dest.type, dest.id, rev, parentOf(path) ?? ''));
	}
</script>

<svelte:head>
	<title>{target ? m.delete_title({ path: target.path }) : repo.id} &ndash; HuggingFox</title>
</svelte:head>

<RequireAuth>
	{#if !target}
		<div class="h-8 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true"></div>
	{:else}
		<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
			<h1 class="text-lg font-semibold">{m.delete_title({ path: target.path })}</h1>
			<FileBreadcrumb type={repo.type} id={repo.id} rev={target.rev} path={target.path} />
		</div>
		{#if !onBranch}
			<BranchRequired action="delete" type={repo.type} id={repo.id} path={target.path} {branches} />
		{:else}
			<form class="max-w-2xl space-y-4" onsubmit={submit}>
				<div
					class="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
				>
					<TriangleAlert size={18} class="mt-0.5 flex-none" aria-hidden="true" />
					<div>
						<p>{m.delete_warning()}</p>
						<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
							<dt>{m.files_col_name()}</dt>
							<dd><code class="font-mono font-semibold break-all">{target.path}</code></dd>
							<dt>{m.upload_branch()}</dt>
							<dd><code class="font-mono font-semibold">{target.rev}</code></dd>
						</dl>
					</div>
				</div>
				<label class="block">
					<span class="mb-1 block text-sm font-semibold">{m.delete_confirm()}</span>
					<input
						type="text"
						class="form-input-alt h-9 w-full px-3 font-mono"
						bind:value={typed}
						autocomplete="off"
						spellcheck="false"
					/>
				</label>
				<CommitFooter
					bind:message
					bind:description
					{placeholder}
					{tip}
					{action}
					submitLabel={m.commit_submit_delete()}
					danger
					disabled={typed !== target.path}
				>
					<a
						href={blobPagePath(repo.type, repo.id, target.rev, target.path)}
						class="rounded-full border border-gray-200 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
					>
						{m.dialog_cancel()}
					</a>
				</CommitFooter>
			</form>
		{/if}
	{/if}
</RequireAuth>
