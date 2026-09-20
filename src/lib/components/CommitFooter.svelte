<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Action } from '$lib/action.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import type { Query } from '$lib/query.svelte';
	import LoadError from './LoadError.svelte';
	import WriteError from './WriteError.svelte';

	// Commit message/description plus the branch-tip guard state shared by every commit form.
	let {
		message = $bindable(''),
		description = $bindable(''),
		placeholder,
		tip,
		action,
		submitLabel,
		danger = false,
		disabled = false,
		onreload,
		reloadLabel,
		children
	}: {
		message?: string;
		description?: string;
		placeholder: string;
		tip: Query<{ sha?: string } | null>;
		action: Action;
		submitLabel: string;
		danger?: boolean;
		disabled?: boolean;
		// Conflict recovery; defaults to refetching the tip, editors reload their base too.
		onreload?: () => void;
		reloadLabel?: string;
		children?: Snippet;
	} = $props();

	const parentCommit = $derived(tip.data?.sha ?? null);
</script>

<div class="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
	<label class="block">
		<span class="mb-1 block text-sm font-semibold">{m.commit_message()}</span>
		<input
			type="text"
			class="form-input-alt h-9 w-full px-3"
			bind:value={message}
			{placeholder}
			maxlength="200"
			autocomplete="off"
		/>
	</label>
	<label class="block">
		<span class="mb-1 block text-sm font-semibold">{m.commit_description()}</span>
		<textarea class="form-input-alt w-full px-3 py-2" rows="2" bind:value={description}></textarea>
	</label>
	{#if tip.pending}
		<p role="status" class="text-sm text-gray-500">{m.commit_tip_loading()}</p>
	{:else if tip.error}
		<LoadError error={tip.error} what={m.upload_branch()} onretry={() => tip.retry()} />
	{:else if !parentCommit}
		<p role="alert" class="text-sm text-red-600 dark:text-red-400">{m.commit_tip_missing()}</p>
	{/if}
	{#if action.error}
		<WriteError error={action.error} onreload={onreload ?? (() => tip.retry())} {reloadLabel} />
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<button
			type="submit"
			class="rounded-full px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 {danger
				? 'bg-red-600 hover:bg-red-700'
				: 'bg-gray-900 hover:bg-black dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white'}"
			disabled={disabled || action.pending || !parentCommit}
			aria-busy={action.pending}
		>
			{submitLabel}
		</button>
		{@render children?.()}
	</div>
</div>
