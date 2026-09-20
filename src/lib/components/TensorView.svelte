<script lang="ts">
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { resolvePath } from '$lib/api/url';
	import { auth } from '$lib/auth.svelte';
	import { boundedFetch, RangeUnsupportedError, SizeLimitError } from '$lib/files/fetch';
	import type { FileTarget } from '$lib/files/safetensors';
	import { formatBytes, formatCompact } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import LoadError from './LoadError.svelte';

	let { target, format }: { target: FileTarget; format: 'safetensors' | 'gguf' } = $props();

	// Headers are read with ranged requests only; these caps bound what a hostile file can make us fetch.
	const MAX_HEADER = 8 * 1024 * 1024;
	const MAX_TOTAL = 32 * 1024 * 1024;

	interface Summary {
		facts: [string, string][];
		metadata: [string, string][];
		tensors: { name: string; dtype: string; shape: string; bytes?: number }[];
		tensorCount: number;
		truncated: boolean;
	}

	// The parsers download only on demand, so the blob page stays light for every other file kind.
	const summary = createQuery(async (signal): Promise<Summary> => {
		const origin = page.url.origin;
		const fetcher = boundedFetch({
			maxBytes: MAX_HEADER,
			totalBytes: MAX_TOTAL,
			origin,
			token: () => auth.token,
			signal
		});
		if (format === 'gguf') {
			const { loadGguf } = await import('$lib/files/gguf');
			const url = origin + resolvePath(target.type, target.id, target.rev, target.path);
			const g = await loadGguf(url, { fetch: fetcher });
			return {
				facts: [
					[m.gguf_architecture(), g.architecture ?? m.stat_unavailable()],
					[m.tensor_params(), formatCompact(g.parameterCount)],
					[m.tensor_count(), String(g.tensorCount)],
					[m.gguf_version(), String(g.version)]
				],
				metadata: g.kv.map((e) => [e.key, e.value]),
				tensors: g.tensors,
				tensorCount: g.tensorCount,
				truncated: g.truncated
			};
		}
		const { loadSafetensors } = await import('$lib/files/safetensors');
		const s = await loadSafetensors(target, { origin, fetch: fetcher });
		const dtypes = Object.entries(s.parameterCount)
			.filter(([, n]) => n)
			.map(([dtype, n]) => `${dtype} ${formatCompact(n ?? 0)}`);
		return {
			facts: [
				[
					m.tensor_params(),
					`${formatCompact(s.parameterTotal)}${dtypes.length ? ` (${dtypes.join(', ')})` : ''}`
				],
				[m.tensor_count(), String(s.tensorCount)]
			],
			metadata: s.metadata,
			tensors: s.tensors.map((t) => ({ ...t, shape: t.shape.join(' × ') })),
			tensorCount: s.tensorCount,
			truncated: s.truncated
		};
	});
	const label = $derived(format === 'gguf' ? 'GGUF' : 'Safetensors');
</script>

<div class="p-4 text-sm" data-testid="tensor-view">
	{#if summary.pending}
		<div class="space-y-2" aria-busy="true" aria-label={m.list_loading()}>
			{#each [30, 60, 90] as width, i (i)}
				<div
					class="h-4 animate-pulse rounded bg-gray-100 dark:bg-gray-800"
					style:width="{width}%"
				></div>
			{/each}
		</div>
	{:else if summary.error instanceof RangeUnsupportedError}
		<p class="text-gray-500" role="status">{m.blob_range_unsupported()}</p>
	{:else if summary.error instanceof SizeLimitError}
		<p class="text-gray-500" role="status">
			{m.blob_header_too_large({ limit: formatBytes(summary.error.limit) })}
		</p>
	{:else if summary.error instanceof ApiError}
		{#if summary.error.status === 404}
			<p class="text-gray-500">{m.files_not_found()}</p>
		{:else}
			<LoadError error={summary.error} what={label} onretry={() => summary.retry()} />
		{/if}
	{:else if summary.error}
		<p class="text-gray-500" role="status">
			{m.blob_malformed({
				format: label,
				detail: String((summary.error as Error).message ?? summary.error)
			})}
		</p>
	{:else if summary.data}
		{@const s = summary.data}
		<dl class="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
			{#each s.facts as [term, value] (term)}
				<dt class="text-gray-500">{term}</dt>
				<dd class="font-semibold break-all">{value}</dd>
			{/each}
		</dl>
		{#if s.metadata.length}
			<h3 class="mb-1 font-semibold">{m.tensor_metadata()}</h3>
			<div class="mb-4 max-h-80 overflow-auto rounded border border-gray-100 dark:border-gray-800">
				<table class="w-full table-fixed text-xs">
					<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
						{#each s.metadata as [key, value] (key)}
							<tr>
								<th scope="row" class="w-2/5 px-2 py-1 text-left font-mono font-normal break-all"
									>{key}</th
								>
								<td class="px-2 py-1 font-mono break-all whitespace-pre-wrap">{value}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		<h3 class="mb-1 font-semibold">{m.tensor_count()}</h3>
		<div class="max-h-96 overflow-auto rounded border border-gray-100 dark:border-gray-800">
			<table class="w-full min-w-[36rem] text-xs">
				<thead class="sticky top-0 bg-gray-50 text-left text-gray-500 dark:bg-gray-900">
					<tr>
						<th class="px-2 py-1 font-normal">{m.tensor_col_name()}</th>
						<th class="px-2 py-1 font-normal">{m.tensor_col_dtype()}</th>
						<th class="px-2 py-1 font-normal">{m.tensor_col_shape()}</th>
						{#if format === 'safetensors'}<th class="px-2 py-1 text-right font-normal"
								>{m.tensor_col_bytes()}</th
							>{/if}
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 font-mono dark:divide-gray-800">
					{#each s.tensors as tensor (tensor.name)}
						<tr>
							<td class="min-w-56 px-2 py-1 whitespace-nowrap">{tensor.name}</td>
							<td class="px-2 py-1 whitespace-nowrap">{tensor.dtype}</td>
							<td class="px-2 py-1 whitespace-nowrap">{tensor.shape}</td>
							{#if format === 'safetensors'}<td class="px-2 py-1 text-right whitespace-nowrap"
									>{tensor.bytes?.toLocaleString()}</td
								>{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if s.truncated}
			<p class="mt-2 text-gray-500">
				{m.tensor_more({ shown: String(s.tensors.length), total: String(s.tensorCount) })}
			</p>
		{/if}
	{/if}
</div>
