<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.error_title({ status: String(page.status) })} – HuggingFox</title>
</svelte:head>

<div class="container py-24 text-center">
	<p class="text-7xl font-bold text-gray-200 dark:text-gray-800">{page.status}</p>
	<p class="mt-4 text-lg text-gray-600 dark:text-gray-400">
		{page.status === 404 ? m.error_not_found() : page.error?.message}
	</p>
	<a href="/" class="mt-8 inline-block underline">{m.error_back_home()}</a>
</div>
