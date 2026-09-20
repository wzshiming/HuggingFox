<script lang="ts">
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import type { RefEntry } from '$lib/api/types';
	import { fileActionPath, type FileAction, type RepoType } from '$lib/api/url';
	import * as m from '$lib/paraglide/messages.js';

	// Writes target a branch; at a tag or commit the same page is offered on each branch instead.
	let {
		action,
		type,
		id,
		path,
		branches
	}: { action: FileAction; type: RepoType; id: string; path: string; branches: RefEntry[] } =
		$props();
</script>

<div
	role="alert"
	class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200"
>
	<p>{m.edit_not_branch()}</p>
	<ul class="mt-2 flex flex-wrap gap-2">
		{#each branches as branch (branch.name)}
			<li>
				<a
					href={fileActionPath(action, type, id, branch.name, path)}
					class="flex items-center gap-1 rounded-lg border border-yellow-300 bg-white px-2 py-0.5 font-mono hover:bg-yellow-100 dark:border-yellow-800 dark:bg-gray-925 dark:hover:bg-gray-900"
				>
					<GitBranch size={12} aria-hidden="true" />
					{branch.name}
				</a>
			</li>
		{/each}
	</ul>
</div>
