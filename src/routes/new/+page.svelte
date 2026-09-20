<script lang="ts">
	import NewRepoForm from '$lib/components/NewRepoForm.svelte';
	import RequireAuth from '$lib/components/RequireAuth.svelte';
</script>

<RequireAuth><NewRepoForm type="model" /></RequireAuth>
