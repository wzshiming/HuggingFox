<script lang="ts">
	import { page } from '$app/state';
	import { repoTypeOf } from '$lib/api/url';
	import Listing from '$lib/components/Listing.svelte';

	const type = $derived(repoTypeOf(page.params.type));
</script>

{#key type}
	<Listing {type} />
{/key}
