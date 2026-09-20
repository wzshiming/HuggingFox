<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Code from '@lucide/svelte/icons/code';
	import { page } from '$app/state';
	import { listPagePath, repoPagePath, type RepoType } from '$lib/api/url';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Readme from '$lib/components/Readme.svelte';
	import { formatBytes, formatCompact } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { useRepo } from '$lib/repo/context.svelte';
	import {
		baseModels,
		datasetStats,
		safetensorsSummary,
		spaceAppUrl,
		stringList
	} from '$lib/repo/meta';
	import { useSnippets } from '$lib/repo/snippets';

	const repo = useRepo();
	const info = $derived(repo.info.data);
	const name = $derived(repo.id.split('/')[1] ?? repo.id);
	const card = $derived((info?.cardData ?? {}) as Record<string, unknown>);
	const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

	const hasReadme = $derived(
		!info?.siblings || info.siblings.some((s) => s.rfilename === 'README.md')
	);
	const snippets = $derived(info ? useSnippets(repo.type, info, page.url.origin) : []);
	const tensors = $derived(info && repo.type === 'model' ? safetensorsSummary(info) : null);
	const bases = $derived(info ? baseModels(info) : []);
	const stats = $derived(info && repo.type === 'dataset' ? datasetStats(info) : null);
	const app = $derived(info && repo.type === 'space' ? spaceAppUrl(info) : null);
	const useLabels: Record<RepoType, () => string> = {
		model: m.use_model,
		dataset: m.use_dataset,
		space: m.use_space
	};
	const derivatives = [
		{ kind: 'finetune', label: m.tree_finetunes },
		{ kind: 'adapter', label: m.tree_adapters },
		{ kind: 'quantized', label: m.tree_quantizations },
		{ kind: 'merge', label: m.tree_merges }
	];
	const filterHref = (param: string, value: string) =>
		`${listPagePath('model')}?${new URLSearchParams({ [param]: value })}`;
</script>

{#if info}
	<div class="flex flex-col gap-8 lg:flex-row">
		<section
			class="min-w-0 flex-1"
			aria-label={repo.type === 'space' ? m.tab_app() : m.card_title()}
		>
			{#if repo.type === 'space'}
				{#if str(card.title) || str(card.short_description)}
					<div class="mb-4">
						<h2 class="text-xl font-semibold">
							{#if str(card.emoji)}<span aria-hidden="true">{card.emoji}</span>{/if}
							{str(card.title) ?? name}
						</h2>
						{#if str(card.short_description)}
							<p class="text-gray-500">{card.short_description}</p>
						{/if}
					</div>
				{/if}
				{#if app}
					<iframe
						src={app}
						title={m.space_app_title({ id: repo.id })}
						class="h-[70vh] w-full rounded-lg border border-gray-200 bg-white dark:border-gray-800"
						sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
						allow="accelerometer; camera; microphone; clipboard-write; fullscreen"
						referrerpolicy="no-referrer"
					></iframe>
				{:else}
					<div
						class="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 text-center text-gray-500 dark:border-gray-700"
						data-testid="space-app-empty"
					>
						<p class="font-semibold">{m.space_not_running()}</p>
						<p class="mt-1 text-sm">
							{m.space_runtime()}: {info.runtime?.stage ?? m.stat_unavailable()}
						</p>
					</div>
				{/if}
			{:else if repo.rev}
				<Readme target={{ type: repo.type, id: repo.id, rev: repo.rev }} exists={hasReadme} />
			{:else}
				<div
					class="h-4 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-800"
					aria-busy="true"
				></div>
			{/if}
		</section>

		<aside
			class="text-sm lg:w-80 lg:shrink-0 lg:border-l lg:border-gray-100 lg:pl-6 xl:w-96 lg:dark:border-gray-800"
			aria-label={m.repo_metadata()}
		>
			<details class="group mb-5">
				<summary
					class="flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 font-semibold text-white hover:bg-black dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
				>
					<Code size={14} aria-hidden="true" />
					{useLabels[repo.type]()}
					<ChevronDown size={14} class="transition group-open:rotate-180" aria-hidden="true" />
				</summary>
				<ul class="mt-3 space-y-3">
					{#each snippets as snippet (snippet.title)}
						<li>
							<div class="mb-1 flex items-center justify-between">
								<span class="font-semibold">{snippet.title}</span>
								<CopyButton text={snippet.code} label={m.copy_snippet({ what: snippet.title })} />
							</div>
							<pre
								class="overflow-x-auto rounded-lg bg-gray-50 p-3 font-mono text-xs dark:bg-gray-925"><code
									>{snippet.code}</code
								></pre>
						</li>
					{/each}
				</ul>
			</details>

			<dl class="divide-y divide-gray-100 dark:divide-gray-800">
				{#if typeof info.downloads === 'number'}
					<div class="py-3">
						<dt class="text-gray-500">{m.stat_downloads()}</dt>
						<dd class="text-xl font-semibold">{info.downloads.toLocaleString()}</dd>
					</div>
				{/if}
				{#if tensors}
					<div class="py-3">
						<dt class="text-gray-500">Safetensors</dt>
						{#if tensors.total !== null}
							<dd>
								<span class="font-semibold">{m.stat_model_size()}</span>
								{formatCompact(tensors.total)} params
								{#if tensors.dtypes.length}
									<span class="text-gray-300 dark:text-gray-600">&middot;</span>
									<span class="font-semibold">{m.stat_tensor_type()}</span>
									{tensors.dtypes.join(', ')}
								{/if}
							</dd>
						{:else}
							<dd class="text-gray-500">{m.stat_metadata_unavailable()}</dd>
						{/if}
					</div>
				{/if}
				{#if stats}
					{#if stats.rows !== null}
						<div class="py-3">
							<dt class="text-gray-500">{m.stat_rows()}</dt>
							<dd class="text-xl font-semibold">{stats.rows.toLocaleString()}</dd>
						</div>
					{/if}
					{#if stats.downloadSize !== null}
						<div class="py-3">
							<dt class="text-gray-500">{m.stat_download_size()}</dt>
							<dd class="font-semibold">{formatBytes(stats.downloadSize)}</dd>
						</div>
					{/if}
				{/if}
				{#if typeof info.usedStorage === 'number' && info.usedStorage > 0}
					<div class="py-3">
						<dt class="text-gray-500">{m.stat_storage()}</dt>
						<dd class="font-semibold">{formatBytes(info.usedStorage)}</dd>
					</div>
				{/if}
				{#if repo.type === 'space'}
					<div class="py-3">
						<dt class="text-gray-500">{m.space_sdk()}</dt>
						<dd class="font-semibold">{info.sdk ?? str(card.sdk) ?? m.stat_unavailable()}</dd>
					</div>
					<div class="py-3">
						<dt class="text-gray-500">{m.space_runtime()}</dt>
						<dd class="font-semibold">
							{info.runtime?.stage ?? m.stat_unavailable()}
							{#if info.runtime?.hardware?.current}
								<span class="font-normal text-gray-500"
									>&middot; {info.runtime.hardware.current}</span
								>
							{/if}
						</dd>
					</div>
				{/if}
			</dl>

			{#if repo.type === 'model'}
				<section class="mt-4">
					<h2 class="mb-2 font-semibold">{m.tree_title({ name })}</h2>
					{#if bases.length}
						<p class="text-gray-500">{m.tree_base_model()}</p>
						<ul class="mb-2">
							{#each bases as id (id)}
								<li>
									<a href={repoPagePath('model', id)} class="font-mono hover:underline">{id}</a>
								</li>
							{/each}
						</ul>
					{/if}
					<ul class="flex flex-wrap gap-x-3 gap-y-1 text-gray-600 dark:text-gray-400">
						{#each derivatives as { kind, label } (kind)}
							<li>
								<a
									href={filterHref('other', `base_model:${kind}:${repo.id}`)}
									class="hover:underline"
								>
									{label()} &rarr;
								</a>
							</li>
						{/each}
					</ul>
				</section>
				{#if info.spaces?.length}
					<section class="mt-4">
						<h2 class="mb-2 font-semibold">
							{m.spaces_using({ name, count: String(info.spaces.length) })}
						</h2>
						<ul class="flex flex-wrap gap-1.5">
							{#each info.spaces.slice(0, 12) as id (id)}
								<li>
									<a
										href={repoPagePath('space', id)}
										class="inline-block max-w-full truncate rounded-lg border border-gray-200 px-2 py-0.5 font-mono text-xs hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
									>
										{id}
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			{:else if repo.type === 'dataset'}
				<section class="mt-4">
					<a
						href={filterHref('dataset', `dataset:${repo.id}`)}
						class="font-semibold hover:underline"
					>
						{m.models_trained({ name })} &rarr;
					</a>
				</section>
			{:else}
				{#each [{ title: m.space_models(), ids: stringList(info.models), type: 'model' as RepoType }, { title: m.space_datasets(), ids: stringList(info.datasets), type: 'dataset' as RepoType }] as group (group.title)}
					{#if group.ids.length}
						<section class="mt-4">
							<h2 class="mb-2 font-semibold">{group.title}</h2>
							<ul class="space-y-0.5">
								{#each group.ids.slice(0, 12) as id (id)}
									<li>
										<a href={repoPagePath(group.type, id)} class="font-mono text-xs hover:underline"
											>{id}</a
										>
									</li>
								{/each}
							</ul>
						</section>
					{/if}
				{/each}
			{/if}
		</aside>
	</div>
{/if}
