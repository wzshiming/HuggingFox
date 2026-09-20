<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';

	let {
		open = $bindable(false),
		title,
		confirmLabel,
		danger = false,
		disabled = false,
		pending = false,
		onconfirm,
		children
	}: {
		open?: boolean;
		title: string;
		confirmLabel: string;
		danger?: boolean;
		disabled?: boolean;
		pending?: boolean;
		onconfirm: () => void;
		children?: Snippet;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	const titleId = $props.id();

	$effect(() => {
		if (open && !dialog?.open) dialog?.showModal();
		else if (!open && dialog?.open) dialog?.close();
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby={titleId}
	class="m-auto w-full max-w-md rounded-lg border border-gray-200 bg-white p-0 text-black shadow-xl backdrop:bg-black/40 dark:border-gray-700 dark:bg-gray-925 dark:text-gray-200"
	onclose={() => (open = false)}
	oncancel={(e) => pending && e.preventDefault()}
>
	<form
		class="p-5"
		onsubmit={(e) => {
			e.preventDefault();
			onconfirm();
		}}
	>
		<h2 id={titleId} class="text-lg font-semibold">{title}</h2>
		<div class="mt-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
			{@render children?.()}
		</div>
		<div class="mt-5 flex justify-end gap-2">
			<button
				type="button"
				class="rounded-full border border-gray-200 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
				disabled={pending}
				onclick={() => (open = false)}
			>
				{m.dialog_cancel()}
			</button>
			<button
				type="submit"
				class="rounded-full px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 {danger
					? 'bg-red-600 hover:bg-red-700'
					: 'bg-gray-900 hover:bg-black dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white'}"
				disabled={disabled || pending}
				aria-busy={pending}
			>
				{pending ? m.action_pending() : confirmLabel}
			</button>
		</div>
	</form>
</dialog>
