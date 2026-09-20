import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render.ts';

describe('renderMarkdown', () => {
	it('renders gfm headings with ids, tables and task lists', () => {
		const html = renderMarkdown(
			'## Model Usage\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n'
		);
		expect(html).toContain('<h2 id="model-usage">Model Usage</h2>');
		expect(html).toContain('<table>');
		expect(html).toContain('<td>2</td>');
		expect(html).toMatch(/<input checked="" disabled="" type="checkbox">/);
	});

	it('highlights fenced code and falls back to plain text for unknown languages', () => {
		const html = renderMarkdown('```python\nimport torch\n```\n\n```nope\nx\n```\n');
		expect(html).toContain('<code class="hljs language-python">');
		expect(html).toContain('<span class="hljs-keyword">import</span>');
		expect(html).toContain('<code class="hljs language-nope">x\n</code>');
	});

	it('renders inline and display math with katex html output only', () => {
		const html = renderMarkdown('Loss $L = \\frac{1}{2}$ and\n\n$$\nE = mc^2\n$$\n');
		expect(html).toContain('class="katex"');
		expect(html).toContain('katex-display');
		expect(html).not.toContain('<math');
		expect(html).not.toContain('<annotation');
	});

	it('passes raw html through for the sanitizer and does not throw on bad tex', () => {
		const html = renderMarkdown('<div align="center"><img src="a.png"></div>\n\n$\\frac{$\n');
		expect(html).toContain('<div align="center"><img src="a.png"></div>');
		expect(html).toContain('frac');
	});
});
