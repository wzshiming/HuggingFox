// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createCardSanitizer } from './sanitize.ts';

const target = { type: 'model' as const, id: 'u/r', rev: 'main' };
const sanitize = createCardSanitizer(window);

describe('createCardSanitizer', () => {
	it('strips scripts, handlers, frames, forms and styles but keeps the text', () => {
		const html = sanitize(
			'<p onmouseover="steal()">Hi<script>alert(1)</script></p>' +
				'<iframe src="https://evil.example"></iframe>' +
				'<form action="https://evil.example"><input name="token"><button>Go</button></form>' +
				'<style>body{display:none}</style>' +
				'<img src="x" onerror="alert(1)">' +
				'<object data="x"></object><embed src="x"><base href="https://evil.example/">',
			target
		);
		expect(html).toBe('<p>Hi</p>Go<img src="/u/r/resolve/main/x">');
	});

	it('removes dangerous urls and rewrites repo-relative ones', () => {
		const html = sanitize(
			'<a href="javascript:alert(1)">js</a>' +
				'<a href="data:text/html,x">data</a>' +
				'<a href="docs/use.md">rel</a>' +
				'<a href="#usage">frag</a>' +
				'<a href="https://example.com" target="_top" rel="opener">ext</a>' +
				'<img src="./a b.png" srcset="a.png 1x"><video poster="p.png" src="v.mp4"></video>',
			target
		);
		expect(html).toBe(
			'<a>js</a><a>data</a><a href="/u/r/blob/main/docs/use.md">rel</a><a href="#usage">frag</a>' +
				'<a href="https://example.com" target="_blank" rel="noopener noreferrer">ext</a>' +
				'<img src="/u/r/resolve/main/a%20b.png">' +
				'<video poster="/u/r/resolve/main/p.png" src="/u/r/resolve/main/v.mp4"></video>'
		);
	});

	it('keeps heading ids, tables, highlighted code, katex spans and task checkboxes', () => {
		const html = sanitize(
			'<h2 id="usage">Usage</h2><table><tr><td>1</td></tr></table>' +
				'<pre><code class="hljs language-python"><span class="hljs-keyword">import</span></code></pre>' +
				'<span class="katex"><span class="katex-html" aria-hidden="true">x</span></span>' +
				'<ul><li><input checked="" disabled="" type="checkbox"> done</li></ul>' +
				'<input type="text" name="x"><input type="checkbox">',
			target
		);
		expect(html).toContain('<h2 id="usage">Usage</h2>');
		expect(html).toContain('<td>1</td>');
		expect(html).toContain('<span class="hljs-keyword">import</span>');
		expect(html).toContain('<span class="katex-html" aria-hidden="true">x</span>');
		expect(html).toContain('<input checked="" disabled="" type="checkbox"> done');
		expect(html).not.toContain('type="text"');
		expect(html).toMatch(/<input type="checkbox" disabled="">$/);
	});

	it('blocks dom clobbering ids and keeps root-relative links unopened', () => {
		const html = sanitize('<a id="location" href="/datasets/u/d">x</a><p id="body">y</p>', target);
		expect(html).toBe('<a href="/datasets/u/d">x</a><p>y</p>');
	});
});
