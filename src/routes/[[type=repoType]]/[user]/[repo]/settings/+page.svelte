<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { goto } from '$app/navigation';
	import { createAction } from '$lib/action.svelte';
	import { repoPagePath } from '$lib/api/url';
	import { hub } from '$lib/auth.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import RequireAuth from '$lib/components/RequireAuth.svelte';
	import WriteError from '$lib/components/WriteError.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { useRepo } from '$lib/repo/context.svelte';
	import { validateRepoName, type RepoNameError } from '$lib/repo/validate';

	const repo = useRepo();
	const owner = $derived(repo.id.split('/')[0]);
	const nameErrors: Record<RepoNameError, () => string> = {
		empty: m.name_error_empty,
		length: m.name_error_length,
		chars: m.name_error_chars,
		double: m.name_error_double,
		git: m.name_error_git
	};

	let newName = $state('');
	let nameError = $state<string | null>(null);
	let renameOpen = $state(false);
	let deleteOpen = $state(false);
	let typed = $state('');
	const rename = createAction();
	const remove = createAction();
	const target = $derived(`${owner}/${newName.trim()}`);

	function askRename(event: SubmitEvent) {
		event.preventDefault();
		const invalid = validateRepoName(newName.trim());
		nameError = invalid ? nameErrors[invalid]() : null;
		if (!invalid) renameOpen = true;
	}

	async function confirmRename() {
		const to = target;
		const moved = await rename.run(async (session, signal) => {
			await hub.moveRepo(repo.type, repo.id, to, { token: session.accessToken, signal });
			return true;
		});
		renameOpen = false;
		if (moved) goto(repoPagePath(repo.type, to));
	}

	async function confirmDelete() {
		const deleted = await remove.run(async (session, signal) => {
			await hub.deleteRepo(repo.type, repo.id, { token: session.accessToken, signal });
			return true;
		});
		deleteOpen = false;
		if (deleted) goto('/settings/repositories');
	}
</script>

<svelte:head>
	<title>{m.tab_settings()} · {repo.id} &ndash; HuggingFox</title>
</svelte:head>

<RequireAuth>
	<div class="max-w-2xl space-y-8">
		<section aria-labelledby="settings-rename">
			<h2 id="settings-rename" class="text-lg font-semibold">{m.settings_rename_title()}</h2>
			<p class="mt-1 text-sm text-gray-500">{m.settings_rename_hint()}</p>
			<form class="mt-3 space-y-3" onsubmit={askRename}>
				<label class="block">
					<span class="mb-1.5 block text-sm font-semibold">{m.settings_new_name()}</span>
					<span class="flex items-center gap-1">
						<span class="font-mono text-gray-500">{owner}/</span>
						<input
							type="text"
							class="form-input-alt h-9 min-w-0 flex-1 px-3 font-mono"
							bind:value={newName}
							autocomplete="off"
							spellcheck="false"
							required
							aria-invalid={nameError ? 'true' : undefined}
							aria-describedby={nameError ? 'rename-error' : undefined}
							oninput={() => (nameError = null)}
						/>
					</span>
				</label>
				{#if nameError}
					<p id="rename-error" role="alert" class="text-sm text-red-600 dark:text-red-400">
						{nameError}
					</p>
				{/if}
				{#if rename.error}
					<WriteError error={rename.error} />
				{/if}
				<button
					type="submit"
					class="rounded-full border border-gray-300 px-4 py-1.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
					disabled={rename.pending}
				>
					{m.settings_rename_title()}
				</button>
			</form>
		</section>

		<section
			aria-labelledby="settings-delete"
			class="rounded-lg border border-red-200 p-4 dark:border-red-900"
		>
			<h2
				id="settings-delete"
				class="flex items-center gap-2 text-lg font-semibold text-red-700 dark:text-red-400"
			>
				<TriangleAlert size={18} aria-hidden="true" />
				{m.settings_delete_title()}
			</h2>
			<p class="mt-1 text-sm text-gray-500">{m.settings_delete_hint({ id: repo.id })}</p>
			{#if remove.error}
				<div class="mt-3"><WriteError error={remove.error} /></div>
			{/if}
			<button
				type="button"
				class="mt-3 rounded-full border border-red-300 px-4 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
				disabled={remove.pending}
				onclick={() => {
					typed = '';
					deleteOpen = true;
				}}
			>
				{m.settings_delete_open()}
			</button>
		</section>
	</div>

	<ConfirmDialog
		bind:open={renameOpen}
		title={m.settings_rename_confirm({ from: repo.id, to: target })}
		confirmLabel={m.settings_rename_action()}
		pending={rename.pending}
		onconfirm={confirmRename}
	>
		<p>{m.settings_rename_hint()}</p>
	</ConfirmDialog>

	<ConfirmDialog
		bind:open={deleteOpen}
		title={m.settings_delete_title()}
		confirmLabel={m.settings_delete_action()}
		danger
		disabled={typed !== repo.id}
		pending={remove.pending}
		onconfirm={confirmDelete}
	>
		<p>{m.settings_delete_hint({ id: repo.id })}</p>
		<label class="block">
			<span class="mb-1 block font-semibold">{m.settings_delete_confirm({ id: repo.id })}</span>
			<input
				type="text"
				class="form-input-alt h-9 w-full px-3 font-mono"
				bind:value={typed}
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
	</ConfirmDialog>
</RequireAuth>
