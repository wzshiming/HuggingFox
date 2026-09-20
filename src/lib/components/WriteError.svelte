<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { page } from '$app/state';
	import { writeError } from '$lib/api/write';
	import { loginPath } from '$lib/navigation';
	import * as m from '$lib/paraglide/messages.js';

	// onreload marks a branch-tip conflict as recoverable; reloadLabel names what it reloads.
	let {
		error,
		onreload,
		reloadLabel
	}: { error: unknown; onreload?: () => void; reloadLabel?: string } = $props();

	const failure = $derived(writeError(error));
	const conflict = $derived(!!onreload && (failure.status === 409 || failure.status === 412));
	const text = $derived.by(() => {
		const args = { status: String(failure.status ?? '–'), detail: failure.detail };
		if (failure.status === 401) return m.write_unauthorized(args);
		if (failure.status === 403) return m.write_forbidden(args);
		if (conflict) return m.write_conflict(args);
		return m.write_failed(args);
	});
</script>

{#if !failure.aborted}
	<div
		role="alert"
		class="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
	>
		<CircleAlert size={16} class="flex-none" aria-hidden="true" />
		<p class="min-w-0 flex-1 break-words">{text}</p>
		{#if failure.status === 401}
			<a href={loginPath(page.url.pathname + page.url.search, true)} class="underline"
				>{m.auth_login()}</a
			>
		{:else if conflict}
			<button
				type="button"
				class="rounded-full border border-red-300 px-3 py-0.5 hover:bg-white dark:border-red-800 dark:hover:bg-red-900"
				onclick={onreload}
			>
				{reloadLabel ?? m.commit_reload_tip()}
			</button>
		{/if}
	</div>
{/if}
