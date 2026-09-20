<script lang="ts">
	import { initials } from '$lib/repo/meta';

	let {
		src,
		name,
		size = 'h-10 w-10 text-sm'
	}: { src?: string | null; name: string; size?: string } = $props();

	let failed = $state(false);
	// A new source gets a fresh attempt before falling back to initials.
	$effect(() => {
		void src;
		failed = false;
	});
</script>

{#if src && !failed}
	<img
		{src}
		alt=""
		class="{size} flex-none rounded-full bg-gray-100 object-cover dark:bg-gray-800"
		onerror={() => (failed = true)}
	/>
{:else}
	<span
		class="{size} flex flex-none items-center justify-center rounded-full bg-gray-200 font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
		aria-hidden="true"
		data-testid="avatar-initials"
	>
		{initials(name)}
	</span>
{/if}
