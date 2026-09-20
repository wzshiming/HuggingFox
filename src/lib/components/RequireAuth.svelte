<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import { loginPath } from '$lib/navigation';
	import * as m from '$lib/paraglide/messages.js';

	let { children }: { children: Snippet } = $props();

	const next = $derived(loginPath(page.url.pathname + page.url.search));

	// Without any token there is nothing to verify; a stored token is checked before deciding.
	$effect(() => {
		if (!auth.user && !auth.token && !auth.pending) goto(next, { replaceState: true });
	});
</script>

{#if auth.user}
	{@render children()}
{:else if auth.token}
	<div class="container py-16 text-center text-gray-500">
		{#if auth.pending || !auth.restoreError}
			<p role="status" aria-busy="true">{m.auth_checking()}</p>
		{:else}
			<p role="alert">{m.auth_unverified()}</p>
			<p class="mt-4 flex justify-center gap-4 text-sm">
				<button type="button" class="underline" onclick={() => auth.restore()}
					>{m.list_retry()}</button
				>
				<a href={next} class="underline">{m.auth_login()}</a>
			</p>
		{/if}
	</div>
{/if}
