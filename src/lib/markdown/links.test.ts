import { describe, expect, it } from 'vitest';
import { rewriteCardUrl } from './links.ts';

const target = { type: 'model' as const, id: 'u/r', rev: 'main' };

describe('rewriteCardUrl', () => {
	it('keeps same-page fragments and root-relative app paths', () => {
		expect(rewriteCardUrl('#usage', 'href', target)).toEqual({ url: '#usage', external: false });
		expect(rewriteCardUrl('/datasets/u/d', 'href', target)).toEqual({
			url: '/datasets/u/d',
			external: false
		});
	});

	it('marks http(s) and protocol-relative urls as external', () => {
		expect(rewriteCardUrl('https://example.com/a?b=1#c', 'href', target)).toEqual({
			url: 'https://example.com/a?b=1#c',
			external: true
		});
		expect(rewriteCardUrl('HTTP://example.com', 'href', target)?.external).toBe(true);
		expect(rewriteCardUrl('//cdn.example/x.png', 'src', target)).toEqual({
			url: '//cdn.example/x.png',
			external: true
		});
	});

	it('drops scriptable, html and unknown schemes even when obfuscated', () => {
		for (const bad of [
			'javascript:alert(1)',
			'JaVaScRiPt:alert(1)',
			'java\tscript:alert(1)',
			' \njavascript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'vbscript:msgbox',
			'file:///etc/passwd',
			'blob:https://x/y',
			''
		]) {
			expect(rewriteCardUrl(bad, 'href', target)).toBe(null);
			expect(rewriteCardUrl(bad, 'src', target)).toBe(null);
		}
	});

	it('allows mailto links and inline image data only where they belong', () => {
		expect(rewriteCardUrl('mailto:a@b.c', 'href', target)).toEqual({
			url: 'mailto:a@b.c',
			external: false
		});
		expect(rewriteCardUrl('mailto:a@b.c', 'src', target)).toBe(null);
		const png = 'data:image/png;base64,iVBORw0KGgo=';
		expect(rewriteCardUrl(png, 'src', target)).toEqual({ url: png, external: false });
		expect(rewriteCardUrl(png, 'href', target)).toBe(null);
		expect(rewriteCardUrl('data:image/svg+xml,<svg onload=alert(1)>', 'src', target)).toBe(null);
	});

	it('rewrites repo-relative images to resolve urls and links to blob pages', () => {
		expect(rewriteCardUrl('./assets/plot 1.png', 'src', target)).toEqual({
			url: '/u/r/resolve/main/assets/plot%201.png',
			external: false
		});
		expect(rewriteCardUrl('assets/plot%201.png', 'src', target)?.url).toBe(
			'/u/r/resolve/main/assets/plot%201.png'
		);
		expect(rewriteCardUrl('docs/usage.md#top', 'href', target)).toEqual({
			url: '/u/r/blob/main/docs/usage.md#top',
			external: false
		});
		expect(
			rewriteCardUrl('../../etc/x.md?raw=1', 'href', { type: 'dataset', id: 'u/d', rev: 'v1.0' })
		).toEqual({ url: '/datasets/u/d/blob/v1.0/etc/x.md', external: false });
		expect(rewriteCardUrl('./', 'href', target)).toBe(null);
		expect(rewriteCardUrl('?tab=readme', 'href', target)).toBe(null);
	});

	it('resolves relative paths against the folder of a nested markdown file', () => {
		const nested = { ...target, dir: 'docs/guide' };
		expect(rewriteCardUrl('images/a.png', 'src', nested)?.url).toBe(
			'/u/r/resolve/main/docs/guide/images/a.png'
		);
		expect(rewriteCardUrl('../api.md', 'href', nested)?.url).toBe('/u/r/blob/main/docs/api.md');
		expect(rewriteCardUrl('../../../README.md', 'href', nested)?.url).toBe(
			'/u/r/blob/main/README.md'
		);
		expect(rewriteCardUrl('/absolute', 'href', nested)?.url).toBe('/absolute');
	});
});
