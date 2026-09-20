<script lang="ts">
	import Box from '@lucide/svelte/icons/box';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import Table from '@lucide/svelte/icons/table';
	import logo from '$logo/logo.svg';
	import type { RepoType } from '$lib/api/url';
	import RepoList from '$lib/components/RepoList.svelte';
	import * as m from '$lib/paraglide/messages.js';

	const sections = $derived([
		{ type: 'model' as RepoType, href: '/models', label: m.nav_models(), icon: Box },
		{ type: 'dataset' as RepoType, href: '/datasets', label: m.nav_datasets(), icon: Table },
		{ type: 'space' as RepoType, href: '/spaces', label: m.nav_spaces(), icon: LayoutGrid }
	]);
	const trending = { sort: 'trendingScore', direction: -1, limit: 8 } as const;
</script>

<svelte:head>
	<title>HuggingFox – {m.app_tagline()}</title>
</svelte:head>

<section class="container pt-10 sm:pt-14">
	<div class="flex items-center gap-4 sm:gap-5">
		<img src={logo} alt="" class="h-16 w-16 flex-none sm:h-20 sm:w-20" />
		<div>
			<h1 class="text-3xl font-bold sm:text-4xl">HuggingFox</h1>
			<p class="text-lg text-gray-500 dark:text-gray-400">{m.app_tagline()}</p>
		</div>
	</div>
	<p class="mt-4 max-w-xl text-gray-600 dark:text-gray-400">{m.app_intro()}</p>
</section>

<section class="container mb-16 pt-10 sm:mb-24 sm:pt-14">
	<div class="mb-8 flex items-center justify-center gap-2 text-xl font-bold sm:mb-12">
		<div
			class="mr-2 h-px flex-1 translate-y-px bg-linear-to-l from-gray-200 to-white dark:from-gray-800 dark:to-gray-950"
		></div>
		<img src={logo} alt="" class="w-7" />
		{m.home_trending()}
		<div
			class="ml-2 h-px flex-1 translate-y-px bg-linear-to-r from-gray-200 to-white dark:from-gray-800 dark:to-gray-950"
		></div>
	</div>
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		{#each sections as section (section.type)}
			<div class="flex flex-col">
				<h2 class="mb-5 flex items-center justify-center gap-2 text-lg font-semibold">
					<section.icon size={18} class="text-gray-400" aria-hidden="true" />
					{section.label}
				</h2>
				<RepoList type={section.type} params={trending} what={section.label} />
				<a
					href={section.href}
					class="mt-4 text-center text-sm text-gray-500 hover:underline dark:text-gray-400"
				>
					{m.list_browse_all({ what: section.label })} →
				</a>
			</div>
		{/each}
	</div>
</section>
