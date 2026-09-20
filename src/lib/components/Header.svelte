<script lang="ts">
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Box from '@lucide/svelte/icons/box';
	import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
	import Languages from '@lucide/svelte/icons/languages';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Menu from '@lucide/svelte/icons/menu';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Plus from '@lucide/svelte/icons/plus';
	import Sun from '@lucide/svelte/icons/sun';
	import Table from '@lucide/svelte/icons/table';
	import User from '@lucide/svelte/icons/user';
	import X from '@lucide/svelte/icons/x';
	import { page } from '$app/state';
	import logo from '$logo/logo.svg';
	import { auth } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale, locales, setLocale } from '$lib/paraglide/runtime.js';
	import { theme } from '$lib/theme.svelte';
	import SearchBox from './SearchBox.svelte';

	const nav = $derived([
		{ href: '/models', label: m.nav_models(), icon: Box, hover: 'hover:text-indigo-700' },
		{ href: '/datasets', label: m.nav_datasets(), icon: Table, hover: 'hover:text-red-700' },
		{ href: '/spaces', label: m.nav_spaces(), icon: LayoutGrid, hover: 'hover:text-blue-700' },
		{
			href: 'https://huggingface.co/docs',
			label: m.nav_docs(),
			icon: BookOpen,
			hover: 'hover:text-yellow-700'
		}
	]);

	const themes = {
		light: { icon: Sun, label: m.theme_light },
		dark: { icon: Moon, label: m.theme_dark },
		system: { icon: Monitor, label: m.theme_system }
	};
	const manage = $derived([
		{ href: '/settings/repositories', label: m.menu_my_repos(), icon: FolderGit2 },
		{ href: '/new', label: m.menu_new_model(), icon: Plus },
		{ href: '/new-dataset', label: m.menu_new_dataset(), icon: Plus },
		{ href: '/new-space', label: m.menu_new_space(), icon: Plus }
	]);
	const localeNames: Record<string, string> = { en: 'EN', 'zh-CN': '中文' };
	const otherLocale = $derived(locales.find((locale) => locale !== getLocale()) ?? getLocale());

	let mobileOpen = $state(false);
	let userOpen = $state(false);
	let userMenu = $state<HTMLElement>();

	const isCurrent = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);

	$effect(() => {
		void page.url.pathname;
		mobileOpen = false;
		userOpen = false;
	});

	function logout() {
		userOpen = false;
		mobileOpen = false;
		auth.logout();
	}
</script>

{#snippet themeButton(extra = '')}
	{@const current = themes[theme.value]}
	<button
		type="button"
		class="flex items-center gap-1.5 rounded-full px-2 py-0.5 hover:text-gray-500 dark:text-gray-300 dark:hover:text-gray-100 {extra}"
		title="{m.theme_label()}: {current.label()}"
		aria-label="{m.theme_label()}: {current.label()}"
		onclick={theme.cycle}
	>
		<current.icon size={16} aria-hidden="true" />
		<span class="lg:sr-only">{current.label()}</span>
	</button>
{/snippet}

{#snippet localeButton(extra = '')}
	<button
		type="button"
		class="flex items-center gap-1.5 rounded-full px-2 py-0.5 hover:text-gray-500 dark:text-gray-300 dark:hover:text-gray-100 {extra}"
		title={m.locale_label()}
		aria-label="{m.locale_label()}: {localeNames[otherLocale] ?? otherLocale}"
		onclick={() => setLocale(otherLocale)}
	>
		<Languages size={16} aria-hidden="true" />
		<span class="text-xs font-semibold">{localeNames[otherLocale] ?? otherLocale}</span>
	</button>
{/snippet}

{#snippet navLinks(extra = '')}
	{#each nav as item (item.href)}
		<li class={item.hover}>
			<a
				href={item.href}
				class="group flex items-center px-2 py-0.5 dark:text-gray-300 dark:hover:text-gray-100 {extra}"
				class:font-semibold={isCurrent(item.href)}
				aria-current={isCurrent(item.href) ? 'page' : undefined}
				target={item.href.startsWith('http') ? '_blank' : undefined}
				rel={item.href.startsWith('http') ? 'noreferrer' : undefined}
			>
				<item.icon
					size={16}
					class="mr-1.5 text-gray-400 group-hover:text-current"
					aria-hidden="true"
				/>
				{item.label}
			</a>
		</li>
	{/each}
{/snippet}

<header class="border-b border-gray-100 dark:border-gray-800">
	<div class="container flex h-16 items-center">
		<div class="flex flex-1 items-center">
			<a class="mr-5 flex flex-none items-center lg:mr-6" href="/" aria-label="HuggingFox">
				<img src={logo} alt="" class="w-7 md:mr-2" />
				<span class="hidden text-lg font-bold whitespace-nowrap md:block">HuggingFox</span>
			</a>
			<SearchBox />
			<button
				type="button"
				class="flex h-8 w-8 flex-none items-center justify-center lg:hidden"
				aria-expanded={mobileOpen}
				aria-controls="mobile-nav"
				aria-label={mobileOpen ? m.nav_close_menu() : m.nav_open_menu()}
				onclick={() => (mobileOpen = !mobileOpen)}
			>
				{#if mobileOpen}<X size={20} aria-hidden="true" />{:else}<Menu
						size={20}
						aria-hidden="true"
					/>{/if}
			</button>
		</div>
		<nav aria-label={m.nav_main()} class="ml-auto hidden lg:block">
			<ul class="flex items-center gap-x-1 text-smd">
				{@render navLinks()}
				<li><hr class="h-5 w-0.5 border-none bg-gray-100 dark:bg-gray-800" /></li>
				<li>{@render themeButton()}</li>
				<li>{@render localeButton()}</li>
				<li><hr class="h-5 w-0.5 border-none bg-gray-100 dark:bg-gray-800" /></li>
				{#if auth.user}
					<li class="relative" bind:this={userMenu}>
						<button
							type="button"
							class="flex items-center gap-1.5 rounded-full px-1 py-0.5 hover:text-gray-500"
							aria-haspopup="menu"
							aria-expanded={userOpen}
							aria-label={m.auth_user_menu()}
							onclick={() => (userOpen = !userOpen)}
							onkeydown={(e) => e.key === 'Escape' && (userOpen = false)}
						>
							{#if auth.user.avatarUrl}
								<img src={auth.user.avatarUrl} alt="" class="h-7 w-7 rounded-full bg-gray-100" />
							{:else}
								<span
									class="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800"
								>
									<User size={16} aria-hidden="true" />
								</span>
							{/if}
						</button>
						{#if userOpen}
							<div
								role="menu"
								class="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-gray-100 bg-white py-1 text-sm shadow-lg dark:border-gray-800 dark:bg-gray-925"
								onfocusout={(e) => {
									if (!userMenu?.contains(e.relatedTarget as Node | null)) userOpen = false;
								}}
							>
								<p class="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
									<span class="block text-xs text-gray-500">{m.auth_signed_in_as()}</span>
									<span class="block truncate font-semibold">{auth.user.name}</span>
								</p>
								{#each manage as item (item.href)}
									<a
										href={item.href}
										role="menuitem"
										class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
									>
										<item.icon size={14} class="text-gray-400" aria-hidden="true" />
										{item.label}
									</a>
								{/each}
								<hr class="my-1 border-gray-100 dark:border-gray-800" />
								<button
									type="button"
									role="menuitem"
									class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
									onclick={logout}
								>
									<LogOut size={14} aria-hidden="true" />
									{m.auth_logout()}
								</button>
							</div>
						{/if}
					</li>
				{:else}
					<li>
						<a
							class="block cursor-pointer px-2 py-0.5 whitespace-nowrap hover:text-gray-500 dark:text-gray-300 dark:hover:text-gray-100"
							href="/login"
						>
							{m.auth_login()}
						</a>
					</li>
				{/if}
			</ul>
		</nav>
	</div>
	{#if mobileOpen}
		<nav
			id="mobile-nav"
			aria-label={m.nav_main()}
			class="border-t border-gray-100 lg:hidden dark:border-gray-800"
		>
			<ul class="container flex flex-col gap-1 py-3 text-smd">
				{@render navLinks('py-1.5')}
				<li class="my-1 border-t border-gray-100 dark:border-gray-800"></li>
				<li class="flex items-center gap-2">
					{@render themeButton('py-1.5')}
					{@render localeButton('py-1.5')}
				</li>
				<li class="my-1 border-t border-gray-100 dark:border-gray-800"></li>
				{#if auth.user}
					<li class="px-2 py-1.5 text-gray-500">
						{m.auth_signed_in_as()}
						<span class="font-semibold text-black dark:text-gray-200">{auth.user.name}</span>
					</li>
					{#each manage as item (item.href)}
						<li>
							<a href={item.href} class="flex items-center gap-2 px-2 py-1.5">
								<item.icon size={16} class="text-gray-400" aria-hidden="true" />
								{item.label}
							</a>
						</li>
					{/each}
					<li>
						<button type="button" class="flex items-center gap-2 px-2 py-1.5" onclick={logout}>
							<LogOut size={16} aria-hidden="true" />
							{m.auth_logout()}
						</button>
					</li>
				{:else}
					<li><a href="/login" class="block px-2 py-1.5">{m.auth_login()}</a></li>
				{/if}
			</ul>
		</nav>
	{/if}
</header>
