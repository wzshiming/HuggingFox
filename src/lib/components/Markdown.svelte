<script module lang="ts">
	import type { CardTarget } from '$lib/markdown/links';

	// marked, highlight.js, KaTeX and DOMPurify only download once a card is actually shown.
	const pipeline = Promise.all([
		import('$lib/markdown/render'),
		import('$lib/markdown/sanitize')
	]).then(([{ renderMarkdown }, { createCardSanitizer }]) => {
		const sanitize = createCardSanitizer();
		return (source: string, target: CardTarget) => sanitize(renderMarkdown(source), target);
	});
</script>

<script lang="ts">
	import 'katex/dist/katex.min.css';

	let { source, target }: { source: string; target: CardTarget } = $props();
</script>

{#await pipeline then render}
	<div class="markdown prose prose-gray max-w-none dark:prose-invert">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- output of the card sanitizer -->
		{@html render(source, target)}
	</div>
{/await}
