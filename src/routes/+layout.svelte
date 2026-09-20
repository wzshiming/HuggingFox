<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import logo from '$logo/logo.svg';
	import { auth } from '$lib/auth.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Header from '$lib/components/Header.svelte';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { theme } from '$lib/theme.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Set before the first render so formatters read the right <html lang>.
	document.documentElement.lang = getLocale();

	$effect(() => {
		document.documentElement.classList.toggle('dark', theme.dark);
		document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light';
	});

	onMount(() => {
		auth.restore();
	});
</script>

<svelte:head>
	<title>HuggingFox</title>
	<link rel="icon" href={logo} />
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<Header />
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
</div>
