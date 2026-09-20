<script lang="ts">
	let { text, language }: { text: string; language: string | null } = $props();

	// Beyond this highlight.js gets slow; the file still renders as plain text.
	const HIGHLIGHT_MAX = 300_000;

	const lines = $derived(
		text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
	);
	const html = $derived(
		language && text.length <= HIGHLIGHT_MAX
			? import('$lib/markdown/render').then((mod) => mod.highlightCode(text, language))
			: Promise.resolve(null)
	);
</script>

<div class="code-view flex overflow-x-auto font-mono text-xs leading-5" data-testid="code-view">
	<div
		class="sticky left-0 flex-none select-none border-r border-gray-100 bg-white py-2 pr-3 pl-3 text-right text-gray-400 dark:border-gray-800 dark:bg-gray-950"
		aria-hidden="true"
	>
		{#each { length: lines }, i (i)}
			<div>{i + 1}</div>
		{/each}
	</div>
	<pre class="m-0 flex-1 py-2 pr-4 pl-3"><code
			>{#await html}{text}{:then value}{#if value !== null}{@html value}<!-- eslint-disable-line svelte/no-at-html-tags -- highlight.js escapes the source -->{:else}{text}{/if}{:catch}{text}{/await}</code
		></pre>
</div>
