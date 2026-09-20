<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { createAction } from '$lib/action.svelte';
	import { blobPagePath, treePagePath, type RepoType } from '$lib/api/url';
	import { commitFiles } from '$lib/api/write';
	import { fileKind, parentOf } from '$lib/files/kind';
	import * as m from '$lib/paraglide/messages.js';
	import type { Query } from '$lib/query.svelte';
	import { useRepo } from '$lib/repo/context.svelte';
	import { joinPath, validateFilePath, type FilePathError } from '$lib/repo/validate';
	import CommitFooter from './CommitFooter.svelte';
	import Markdown from './Markdown.svelte';

	// `edit` commits over a fixed path; `new` asks for a file name under `dir`.
	// In edit mode `tip` is the base snapshot the text was read at, so its sha guards exactly that text.
	let {
		type,
		id,
		branch,
		tip,
		mode,
		path = '',
		dir = '',
		text = ''
	}: {
		type: RepoType;
		id: string;
		branch: string;
		tip: Query<{ sha?: string } | null>;
		mode: 'new' | 'edit';
		path?: string;
		dir?: string;
		text?: string;
	} = $props();

	const pathErrors: Record<FilePathError, () => string> = {
		empty: m.path_error_empty,
		invalid: m.path_error_invalid
	};

	// The initial text is the baseline for the dirty check; the page keys the editor per rev/path.
	// svelte-ignore state_referenced_locally
	let content = $state(text);
	let fileName = $state('');
	let message = $state('');
	let description = $state('');
	let pathError = $state<string | null>(null);
	let tab = $state<'edit' | 'preview'>('edit');
	let saved = false;
	const action = createAction();
	const repo = useRepo();

	const target = $derived(mode === 'edit' ? path : joinPath(dir, fileName.trim()));
	const dirty = $derived(mode === 'edit' ? content !== text : content !== '' || fileName !== '');
	const markdown = $derived(fileKind(target).kind === 'markdown');
	const placeholder = $derived(
		mode === 'edit'
			? m.commit_default_update({ path: target })
			: m.commit_default_create({ path: target })
	);
	const tabs = [
		{ value: 'edit', label: m.edit_tab_edit },
		{ value: 'preview', label: m.blob_preview }
	] as const;

	beforeNavigate((navigation) => {
		if (dirty && !saved && !confirm(m.edit_unsaved())) navigation.cancel();
	});

	// A conflict reload replaces text and parent together; dirty edits are dropped only after confirmation.
	function reload() {
		if (dirty && !confirm(m.edit_reload_confirm())) return;
		tip.retry();
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const invalid = mode === 'new' ? validateFilePath(target) : null;
		pathError = invalid ? pathErrors[invalid]() : null;
		const parentCommit = tip.data?.sha;
		if (invalid || !parentCommit) return;
		const committed = target;
		const dest = { type, id };
		const result = await action.run((session, signal) =>
			commitFiles(session, dest, {
				branch,
				parentCommit,
				title: message.trim() || placeholder,
				description: description.trim() || undefined,
				operations: [{ path: committed, content: new Blob([content]) }],
				signal
			})
		);
		if (!result) return;
		saved = true;
		repo.refresh();
		goto(blobPagePath(dest.type, dest.id, branch, committed));
	}
</script>

<svelte:window
	onbeforeunload={(e) => {
		if (dirty && !saved) e.preventDefault();
	}}
/>

<form class="space-y-4" onsubmit={submit}>
	{#if mode === 'new'}
		<label class="block">
			<span class="mb-1 block text-sm font-semibold">{m.new_file_name()}</span>
			<span class="flex items-center gap-1">
				{#if dir}<span class="font-mono text-gray-500">{dir}/</span>{/if}
				<input
					type="text"
					class="form-input-alt h-9 min-w-0 flex-1 px-3 font-mono"
					bind:value={fileName}
					autocomplete="off"
					spellcheck="false"
					required
					aria-invalid={pathError ? 'true' : undefined}
					aria-describedby={pathError ? 'file-name-error' : undefined}
					oninput={() => (pathError = null)}
				/>
			</span>
		</label>
		{#if pathError}
			<p id="file-name-error" role="alert" class="text-sm text-red-600 dark:text-red-400">
				{pathError}
			</p>
		{/if}
	{/if}

	<div class="rounded-lg border border-gray-200 dark:border-gray-700">
		{#if markdown}
			<div role="tablist" class="flex border-b border-gray-200 px-2 text-sm dark:border-gray-700">
				{#each tabs as item (item.value)}
					<button
						type="button"
						role="tab"
						aria-selected={tab === item.value}
						class="-mb-px border-b-2 px-3 py-2 {tab === item.value
							? 'border-gray-800 font-semibold dark:border-gray-200'
							: 'border-transparent text-gray-500'}"
						onclick={() => (tab = item.value)}
					>
						{item.label()}
					</button>
				{/each}
			</div>
		{/if}
		{#if tab === 'preview' && markdown}
			<div class="p-4 sm:p-6" role="tabpanel">
				<Markdown
					source={content}
					target={{ type, id, rev: branch, dir: parentOf(target) ?? '' }}
				/>
			</div>
		{:else}
			<textarea
				class="block w-full resize-y rounded-b-lg bg-white p-3 font-mono text-sm outline-none dark:bg-gray-950"
				rows="24"
				spellcheck="false"
				aria-label={m.edit_content()}
				bind:value={content}></textarea>
		{/if}
	</div>

	<CommitFooter
		bind:message
		bind:description
		{placeholder}
		{tip}
		{action}
		submitLabel={mode === 'edit' ? m.commit_submit_edit() : m.commit_submit_new()}
		onreload={mode === 'edit' ? reload : undefined}
		reloadLabel={mode === 'edit' ? m.edit_reload() : undefined}
	>
		<a
			href={mode === 'edit'
				? blobPagePath(type, id, branch, path)
				: treePagePath(type, id, branch, dir)}
			class="rounded-full border border-gray-200 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
		>
			{m.dialog_cancel()}
		</a>
	</CommitFooter>
</form>
