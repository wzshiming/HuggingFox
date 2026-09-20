<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { DiffFile } from '$lib/history/diff';
	import * as m from '$lib/paraglide/messages.js';

	let { file, open = true }: { file: DiffFile; open?: boolean } = $props();

	const statusLabels = {
		added: m.diff_added,
		deleted: m.diff_deleted,
		renamed: m.diff_renamed,
		modified: m.diff_modified
	};
	const rowClass = {
		add: 'bg-green-50 dark:bg-green-950/60',
		del: 'bg-red-50 dark:bg-red-950/60',
		context: '',
		meta: 'text-gray-400'
	};
	const marks = { add: '+', del: '-', context: ' ', meta: ' ' };
</script>

<details
	{open}
	class="group rounded-lg border border-gray-200 dark:border-gray-700"
	data-testid="diff-file"
>
	<summary
		class="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-t-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900"
	>
		<ChevronRight
			size={14}
			class="flex-none text-gray-400 transition group-open:rotate-90"
			aria-hidden="true"
		/>
		<span class="min-w-0 font-mono break-all">
			{#if file.oldPath}<span class="text-gray-500">{file.oldPath} &rarr;</span>{/if}
			{file.path}
		</span>
		{#if file.status !== 'modified'}
			<span
				class="rounded border border-gray-200 px-1.5 text-xs text-gray-500 dark:border-gray-700"
			>
				{statusLabels[file.status]()}
			</span>
		{/if}
		<span class="ml-auto font-mono text-xs whitespace-nowrap">
			<span class="text-green-700 dark:text-green-400">+{file.additions}</span>
			<span class="text-red-700 dark:text-red-400">&minus;{file.deletions}</span>
		</span>
	</summary>
	{#if file.binary}
		<p class="px-3 py-4 text-sm text-gray-500">{m.diff_binary()}</p>
	{:else if !file.hunks.length}
		<p class="px-3 py-4 text-sm text-gray-500">{m.diff_no_text()}</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full font-mono text-xs leading-5">
				<tbody>
					{#each file.hunks as hunk, h (h)}
						<tr class="bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
							<td colspan="2" class="w-20 select-none"></td>
							<td class="px-2 py-0.5 whitespace-pre">{hunk.header}</td>
						</tr>
						{#each hunk.lines as line, i (i)}
							<tr class={rowClass[line.type]}>
								<td class="w-10 select-none px-2 text-right text-gray-400">{line.oldNo ?? ''}</td>
								<td class="w-10 select-none px-2 text-right text-gray-400">{line.newNo ?? ''}</td>
								<td class="px-2 whitespace-pre"
									><span class="select-none text-gray-400">{marks[line.type]}</span>{line.text}</td
								>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</details>
