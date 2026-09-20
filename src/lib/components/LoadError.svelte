<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { ApiError } from '$lib/api/client';
	import * as m from '$lib/paraglide/messages.js';

	let { error, what, onretry }: { error: unknown; what: string; onretry?: () => void } = $props();

	const detail = $derived(
		error instanceof ApiError
			? `${error.status}: ${error.detail}`
			: String((error as Error)?.message ?? error)
	);
</script>

<div
	role="alert"
	class="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
>
	<CircleAlert size={18} aria-hidden="true" />
	<p class="text-center">{m.list_error({ what, detail })}</p>
	{#if onretry}
		<button
			type="button"
			class="rounded-full border border-red-300 px-3 py-0.5 hover:bg-white dark:border-red-800 dark:hover:bg-red-900"
			onclick={onretry}
		>
			{m.list_retry()}
		</button>
	{/if}
</div>
