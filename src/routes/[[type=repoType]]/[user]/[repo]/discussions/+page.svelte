<script lang="ts">
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import * as m from '$lib/paraglide/messages.js';
	import { useRepo } from '$lib/repo/context.svelte';

	const repo = useRepo();
</script>

<div class="py-16 text-center" data-testid="community-unavailable">
	<MessagesSquare size={40} class="mx-auto text-gray-300 dark:text-gray-700" aria-hidden="true" />
	<h2 class="mt-4 text-lg font-semibold">{m.community_title()}</h2>
	<p class="mt-2 text-gray-500">{m.community_unavailable({ id: repo.id })}</p>
</div>
