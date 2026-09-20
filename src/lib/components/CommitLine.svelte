<script lang="ts">
	import History from '@lucide/svelte/icons/history';
	import { commitPagePath, type RepoType } from '$lib/api/url';
	import { formatDate, formatRelative } from '$lib/format';
	import { shortSha } from '$lib/history/commits';
	import Avatar from './Avatar.svelte';

	let {
		commit,
		type,
		id
	}: {
		commit: {
			id: string;
			title?: string;
			date?: string;
			authors?: { user: string; avatar?: string }[];
		};
		type: RepoType;
		id: string;
	} = $props();

	const author = $derived(commit.authors?.[0]);
</script>

<div
	class="flex min-w-0 items-center gap-2 rounded-t-lg border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
	data-testid="latest-commit"
>
	{#if author}
		<Avatar src={author.avatar} name={author.user} size="h-5 w-5 text-[10px]" />
		<a href="/{encodeURIComponent(author.user)}" class="flex-none font-semibold hover:underline"
			>{author.user}</a
		>
	{:else}
		<History size={14} class="flex-none text-gray-400" aria-hidden="true" />
	{/if}
	<a
		href={commitPagePath(type, id, commit.id)}
		class="min-w-0 flex-1 truncate text-gray-700 hover:underline dark:text-gray-300"
		title={commit.title}
	>
		{commit.title ?? shortSha(commit.id)}
	</a>
	<a
		href={commitPagePath(type, id, commit.id)}
		class="hidden flex-none rounded border border-gray-200 px-1.5 font-mono text-xs text-gray-500 hover:bg-white sm:block dark:border-gray-700 dark:hover:bg-gray-800"
	>
		{shortSha(commit.id)}
	</a>
	{#if commit.date}
		<time datetime={commit.date} title={formatDate(commit.date)} class="flex-none text-gray-500">
			{formatRelative(commit.date)}
		</time>
	{/if}
</div>
