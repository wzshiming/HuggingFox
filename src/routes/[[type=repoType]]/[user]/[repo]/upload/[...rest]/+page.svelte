<script lang="ts">
	import CloudUpload from '@lucide/svelte/icons/cloud-upload';
	import X from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createAction } from '$lib/action.svelte';
	import { treePagePath } from '$lib/api/url';
	import { uploadFiles, type WriteProgress } from '$lib/api/write';
	import { hub } from '$lib/auth.svelte';
	import CommitFooter from '$lib/components/CommitFooter.svelte';
	import FileBreadcrumb from '$lib/components/FileBreadcrumb.svelte';
	import RequireAuth from '$lib/components/RequireAuth.svelte';
	import { formatBytes } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import { splitTarget, useRepo } from '$lib/repo/context.svelte';
	import { joinPath, validateFilePath } from '$lib/repo/validate';

	const repo = useRepo();
	const target = $derived(splitTarget(repo, page.params.rest ?? ''));
	const branches = $derived(repo.refs.data?.branches ?? []);
	const isBranch = (name: string | null | undefined) => branches.some((b) => b.name === name);

	// Uploads always land on a branch: the url's branch, else the default one.
	let chosen = $state<string | null>(null);
	const branch = $derived(
		isBranch(chosen) ? chosen! : target && isBranch(target.rev) ? target.rev : (repo.rev ?? '')
	);
	let folderInput = $state<string | null>(null);
	const folder = $derived(folderInput ?? target?.path ?? '');

	const tip = createQuery(async (signal) =>
		branch ? hub.info(repo.type, repo.id, { revision: branch }, { signal }) : null
	);

	let files = $state.raw<File[]>([]);
	let message = $state('');
	let description = $state('');
	let pathError = $state<string | null>(null);
	let phase = $state<'preuploading' | 'uploadingLargeFiles' | 'committing' | null>(null);
	let states = $state.raw<Record<string, { state: string; progress: number }>>({});
	let note = $state<string | null>(null);
	const action = createAction();

	// The form and any pending upload belong to the url's branch and folder; a reused route starts over.
	const key = $derived(target ? `${target.rev}:${target.path}` : null);
	$effect(() => {
		void key;
		action.cancel();
		action.clear();
		chosen = null;
		folderInput = null;
		files = [];
		message = '';
		description = '';
		pathError = null;
		phase = null;
		states = {};
		note = null;
	});

	const placeholder = $derived(
		files.length === 1
			? m.upload_default_one({ name: files[0].name })
			: files.length
				? m.upload_default_many({ count: String(files.length) })
				: m.files_upload()
	);
	const phases = {
		preuploading: m.upload_phase_preuploading,
		uploadingLargeFiles: m.upload_phase_large,
		committing: m.upload_phase_committing
	};

	function add(list: FileList | File[]) {
		const incoming = Array.from(list);
		files = [...files.filter((f) => !incoming.some((i) => i.name === f.name)), ...incoming];
		pathError = null;
	}

	function stateLabel(path: string) {
		const s = states[path];
		if (!s) return '';
		if (s.state === 'hashing')
			return m.upload_state_hashing({ percent: String(Math.round(s.progress * 100)) });
		return s.progress >= 1 ? m.upload_state_done() : m.upload_state_uploading();
	}

	function onProgress(event: WriteProgress) {
		if (event.event === 'phase') phase = event.phase;
		else states = { ...states, [event.path]: { state: event.state, progress: event.progress } };
	}

	function cancel() {
		note = phase === 'committing' ? m.write_cancelled_committing() : m.upload_cancelled();
		action.cancel();
		phase = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const parentCommit = tip.data?.sha;
		if (!parentCommit || !files.length) return;
		const entries = files.map((file) => ({ path: joinPath(folder, file.name), content: file }));
		if (entries.some((entry) => validateFilePath(entry.path))) {
			pathError = m.path_error_invalid();
			return;
		}
		const dest = { type: repo.type, id: repo.id, branch, folder };
		note = null;
		states = {};
		const result = await action.run((session, signal) =>
			uploadFiles(session, dest, {
				branch: dest.branch,
				parentCommit,
				title: message.trim() || placeholder,
				description: description.trim() || undefined,
				files: entries,
				signal,
				onProgress
			})
		);
		phase = null;
		if (!result) return;
		repo.refresh();
		goto(treePagePath(dest.type, dest.id, dest.branch, dest.folder));
	}
</script>

<svelte:head>
	<title>{m.files_upload()} · {repo.id} &ndash; HuggingFox</title>
</svelte:head>

<RequireAuth>
	{#if !target}
		<div class="h-8 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" aria-busy="true"></div>
	{:else}
		<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
			<h1 class="text-lg font-semibold">{m.files_upload()}</h1>
			<FileBreadcrumb type={repo.type} id={repo.id} rev={branch || target.rev} path={folder} />
		</div>
		<form class="max-w-3xl space-y-4" onsubmit={submit}>
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="block">
					<span class="mb-1 block text-sm font-semibold">{m.upload_branch()}</span>
					<select
						class="form-input-alt h-9 w-full px-2 font-mono"
						value={branch}
						disabled={action.pending}
						onchange={(e) => (chosen = e.currentTarget.value)}
					>
						{#each branches as candidate (candidate.name)}
							<option value={candidate.name}>{candidate.name}</option>
						{/each}
					</select>
				</label>
				<label class="block">
					<span class="mb-1 block text-sm font-semibold">{m.upload_folder()}</span>
					<input
						type="text"
						class="form-input-alt h-9 w-full px-3 font-mono"
						value={folder}
						placeholder={m.upload_folder_hint()}
						autocomplete="off"
						spellcheck="false"
						disabled={action.pending}
						oninput={(e) => {
							folderInput = e.currentTarget.value;
							pathError = null;
						}}
					/>
				</label>
			</div>

			<!-- Drop target only; the labelled file input below is the accessible control. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700"
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => {
					e.preventDefault();
					if (e.dataTransfer && !action.pending) add(e.dataTransfer.files);
				}}
			>
				<CloudUpload size={28} class="mx-auto text-gray-400" aria-hidden="true" />
				<p class="mt-2">
					{m.upload_drop()}
					<label
						class="ml-1 cursor-pointer font-semibold text-gray-900 underline dark:text-gray-100"
					>
						{m.upload_select()}
						<input
							type="file"
							multiple
							class="sr-only"
							disabled={action.pending}
							onchange={(e) => {
								if (e.currentTarget.files) add(e.currentTarget.files);
								e.currentTarget.value = '';
							}}
						/>
					</label>
				</p>
			</div>

			{#if files.length}
				<ul
					class="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-700"
					aria-label={m.upload_selected()}
				>
					{#each files as file (file.name)}
						{@const path = joinPath(folder, file.name)}
						<li class="flex items-center gap-3 px-3 py-1.5">
							<span class="min-w-0 flex-1 truncate font-mono">{path}</span>
							<span class="text-gray-500 whitespace-nowrap">{formatBytes(file.size)}</span>
							{#if action.pending}
								<span class="w-24 text-right text-xs text-gray-500">{stateLabel(path)}</span>
							{:else}
								<button
									type="button"
									class="text-gray-400 hover:text-red-600"
									aria-label={m.upload_remove({ name: file.name })}
									onclick={() => (files = files.filter((f) => f !== file))}
								>
									<X size={14} aria-hidden="true" />
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-gray-500">{m.upload_none()}</p>
			{/if}
			{#if pathError}
				<p role="alert" class="text-sm text-red-600 dark:text-red-400">{pathError}</p>
			{/if}
			{#if phase || note}
				<p role="status" class="text-sm text-gray-600 dark:text-gray-300">
					{phase ? phases[phase]() : note}
				</p>
			{/if}

			<CommitFooter
				bind:message
				bind:description
				{placeholder}
				{tip}
				{action}
				submitLabel={m.files_upload()}
				disabled={!files.length}
			>
				{#if action.pending}
					<button
						type="button"
						class="rounded-full border border-gray-200 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
						onclick={cancel}
					>
						{m.upload_cancel()}
					</button>
				{/if}
			</CommitFooter>
		</form>
	{/if}
</RequireAuth>
