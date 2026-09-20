<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import * as m from '$lib/paraglide/messages.js';

	let { text, label = m.copy() }: { text: string; label?: string } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}
</script>

<button
	type="button"
	class="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
	aria-label={copied ? m.copied() : label}
	title={label}
	onclick={copy}
>
	{#if copied}<Check size={12} aria-hidden="true" />{:else}<Copy
			size={12}
			aria-hidden="true"
		/>{/if}
	<span class="sr-only">{copied ? m.copied() : label}</span>
</button>
