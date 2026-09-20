<script lang="ts">
	import Globe from '@lucide/svelte/icons/globe';
	import { goto } from '$app/navigation';
	import { createAction } from '$lib/action.svelte';
	import { ApiError, type SpaceSdk } from '$lib/api/client';
	import { repoPagePath, type RepoType } from '$lib/api/url';
	import { commitFiles, type WriteSession } from '$lib/api/write';
	import { auth, hub } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { validateRepoName, type RepoNameError } from '$lib/repo/validate';
	import WriteError from './WriteError.svelte';

	let { type }: { type: RepoType } = $props();

	const titles: Record<RepoType, () => string> = {
		model: m.new_model_title,
		dataset: m.new_dataset_title,
		space: m.new_space_title
	};
	const nameErrors: Record<RepoNameError, () => string> = {
		empty: m.name_error_empty,
		length: m.name_error_length,
		chars: m.name_error_chars,
		double: m.name_error_double,
		git: m.name_error_git
	};
	const sdks: SpaceSdk[] = ['gradio', 'streamlit', 'docker', 'static'];
	// Front matter the hub reads a Space's SDK from; written only when create did not persist it.
	const spaceCard = (title: string, sdk: SpaceSdk) => `---\ntitle: ${title}\nsdk: ${sdk}\n---\n`;

	const owners = $derived([
		...(auth.user?.name ? [auth.user.name] : []),
		...(auth.user?.orgs ?? []).map((org) => org.name)
	]);
	let owner = $state('');
	$effect(() => {
		if (!owners.includes(owner)) owner = owners[0] ?? '';
	});
	let name = $state('');
	let sdk = $state<SpaceSdk>('gradio');
	let nameError = $state<string | null>(null);
	// A Space that exists but whose README is still missing; the next submit writes only that.
	let created = $state<string | null>(null);
	const action = createAction();
	const unfinished = $derived(created !== null && created === `${owner}/${name.trim()}`);

	async function missing(load: () => Promise<unknown>) {
		try {
			await load();
			return false;
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) return true;
			throw error;
		}
	}

	// Never over an existing README, and only against the tip create left behind.
	async function initSpace(
		session: WriteSession,
		id: string,
		title: string,
		chosen: SpaceSdk,
		signal: AbortSignal
	) {
		const options = { token: session.accessToken, signal };
		const info = await hub.info('space', id, { revision: 'main' }, options);
		if (info.sdk === chosen) return;
		const sha = info.sha;
		if (!sha) throw new Error(m.commit_tip_missing());
		if (!(await missing(() => hub.text('space', id, sha, 'README.md', { maxBytes: 1 }, options))))
			return;
		await commitFiles(
			session,
			{ type: 'space', id },
			{
				branch: 'main',
				parentCommit: sha,
				title: m.commit_default_create({ path: 'README.md' }),
				operations: [{ path: 'README.md', content: new Blob([spaceCard(title, chosen)]) }],
				signal
			}
		);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		const invalid = validateRepoName(trimmed);
		nameError = invalid ? nameErrors[invalid]() : null;
		if (invalid || !owner) return;
		const id = `${owner}/${trimmed}`;
		const chosen = sdk;
		const outcome = await action.run(async (session, signal) => {
			const options = { token: session.accessToken, signal };
			if (type !== 'space') {
				await hub.createRepo(type, id, {}, options);
				return 'created';
			}
			if (created !== id) {
				if (!(await missing(() => hub.info('space', id, {}, options)))) return 'exists';
				await hub.createRepo(type, id, { sdk: chosen }, options);
				created = id;
			}
			await initSpace(session, id, trimmed, chosen, signal);
			return 'created';
		});
		if (outcome === 'exists') nameError = m.new_exists({ id });
		else if (outcome) goto(repoPagePath(type, id));
	}
</script>

<svelte:head>
	<title>{titles[type]()} &ndash; HuggingFox</title>
</svelte:head>

<div class="container flex justify-center pt-10 pb-24 sm:pt-16">
	<form class="w-full max-w-lg space-y-5" onsubmit={submit} aria-busy={action.pending}>
		<h1 class="text-2xl font-bold">{titles[type]()}</h1>
		<div class="grid gap-3 sm:grid-cols-[1fr_auto_2fr] sm:items-end">
			<label class="block">
				<span class="mb-1.5 block text-sm font-semibold">{m.repo_owner()}</span>
				<select class="form-input-alt h-10 w-full px-3" bind:value={owner} required>
					{#each owners as candidate (candidate)}
						<option value={candidate}>{candidate}</option>
					{/each}
				</select>
			</label>
			<span class="hidden pb-2 text-xl text-gray-300 sm:block dark:text-gray-600">/</span>
			<label class="block">
				<span class="mb-1.5 block text-sm font-semibold">{m.new_name()}</span>
				<input
					type="text"
					class="form-input-alt h-10 w-full px-3 font-mono"
					bind:value={name}
					autocomplete="off"
					spellcheck="false"
					required
					aria-invalid={nameError ? 'true' : undefined}
					aria-describedby={nameError ? 'new-name-error' : undefined}
					oninput={() => (nameError = null)}
				/>
			</label>
		</div>
		{#if nameError}
			<p id="new-name-error" role="alert" class="text-sm text-red-600 dark:text-red-400">
				{nameError}
			</p>
		{/if}
		{#if type === 'space'}
			<label class="block">
				<span class="mb-1.5 block text-sm font-semibold">{m.new_sdk()}</span>
				<select class="form-input-alt h-10 w-full px-3 sm:w-1/2" bind:value={sdk}>
					{#each sdks as candidate (candidate)}
						<option value={candidate}>{candidate}</option>
					{/each}
				</select>
			</label>
		{/if}
		<div
			class="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-925"
		>
			<Globe size={18} class="mt-0.5 flex-none text-gray-500" aria-hidden="true" />
			<div>
				<p class="font-semibold">{m.new_public()}</p>
				<p class="text-gray-500">{m.new_public_hint()}</p>
			</div>
		</div>
		{#if unfinished}
			<p role="status" class="text-sm text-gray-600 dark:text-gray-300">
				{m.new_space_init_failed({ id: created ?? '' })}
			</p>
		{/if}
		{#if action.error}
			<WriteError error={action.error} />
		{/if}
		<button
			type="submit"
			class="h-10 rounded-full bg-gray-900 px-6 font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
			disabled={action.pending}
		>
			{action.pending ? m.new_pending() : unfinished ? m.new_space_init_retry() : m.new_submit()}
		</button>
	</form>
</div>
