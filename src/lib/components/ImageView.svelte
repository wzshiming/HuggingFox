<script lang="ts">
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { downloadPath, resolvePath } from '$lib/api/url';
	import { auth } from '$lib/auth.svelte';
	import { boundedFetch, SizeLimitError } from '$lib/files/fetch';
	import type { FileTarget } from '$lib/files/safetensors';
	import { formatBytes } from '$lib/format';
	import * as m from '$lib/paraglide/messages.js';
	import { createQuery } from '$lib/query.svelte';
	import LoadError from './LoadError.svelte';

	let { target, mime }: { target: FileTarget; mime: string } = $props();

	const MAX_IMAGE = 10 * 1024 * 1024;

	// Fetched in-app so private images get the bearer; the bytes are capped before decoding.
	const image = createQuery(async (signal) => {
		const fetcher = boundedFetch({
			maxBytes: MAX_IMAGE,
			origin: page.url.origin,
			token: () => auth.token,
			signal
		});
		const res = await fetcher(resolvePath(target.type, target.id, target.rev, target.path), {
			headers: { accept: 'image/*' }
		});
		return new Blob([await res.arrayBuffer()], { type: mime });
	});

	let url = $state<string | null>(null);
	$effect(() => {
		const blob = image.data;
		if (!blob) {
			url = null;
			return;
		}
		const next = URL.createObjectURL(blob);
		url = next;
		return () => URL.revokeObjectURL(next);
	});
	const name = $derived(target.path.slice(target.path.lastIndexOf('/') + 1));
</script>

<div class="flex min-h-40 items-center justify-center p-6">
	{#if image.pending}
		<div
			class="h-40 w-64 animate-pulse rounded bg-gray-100 dark:bg-gray-800"
			aria-busy="true"
		></div>
	{:else if image.error instanceof SizeLimitError}
		<p class="text-center text-gray-500">
			{m.blob_image_too_large({
				size: image.error.size === null ? '?' : formatBytes(image.error.size),
				limit: formatBytes(MAX_IMAGE)
			})}
			<a href={downloadPath(target.type, target.id, target.rev, target.path)} class="ml-2 underline"
				>{m.files_download()}</a
			>
		</p>
	{:else if image.error instanceof ApiError && image.error.status === 404}
		<p class="text-gray-500">{m.files_not_found()}</p>
	{:else if image.error}
		<LoadError error={image.error} what={name} onretry={() => image.retry()} />
	{:else if url}
		<img src={url} alt={name} class="max-h-[70vh] max-w-full" />
	{/if}
</div>
