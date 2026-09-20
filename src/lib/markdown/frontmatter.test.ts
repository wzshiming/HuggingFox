import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from './frontmatter.ts';

describe('splitFrontmatter', () => {
	it('parses a leading yaml block and returns the remaining body', () => {
		const { data, body, error } = splitFrontmatter(
			'---\nlanguage: en\ntags:\n- exbert\n\nlicense: mit\nbase_model:\n  - openai/gpt2\n---\n\n# GPT-2\n\nText'
		);
		expect(data).toEqual({
			language: 'en',
			tags: ['exbert'],
			license: 'mit',
			base_model: ['openai/gpt2']
		});
		expect(body).toBe('\n# GPT-2\n\nText');
		expect(error).toBeUndefined();
	});

	it('accepts a bom, crlf line endings and a "..." terminator', () => {
		const { data, body } = splitFrontmatter('\uFEFF---\r\nlicense: mit\r\n...\r\nbody\r\n');
		expect(data).toEqual({ license: 'mit' });
		expect(body).toBe('body\r\n');
	});

	it('returns the whole text as body when there is no frontmatter', () => {
		expect(splitFrontmatter('# Title\n---\nnot: frontmatter\n---\n')).toEqual({
			data: null,
			body: '# Title\n---\nnot: frontmatter\n---\n'
		});
		expect(splitFrontmatter('---\nunterminated: yes\n')).toEqual({
			data: null,
			body: '---\nunterminated: yes\n'
		});
	});

	it('keeps the body and reports invalid yaml instead of throwing', () => {
		const result = splitFrontmatter('---\nlicense: [unclosed\n---\nbody');
		expect(result.data).toBe(null);
		expect(result.body).toBe('body');
		expect(result.error).toMatch(/\S/);
	});

	it('only exposes mappings, never scalars or lists, as card data', () => {
		expect(splitFrontmatter('---\njust a string\n---\nbody').data).toBe(null);
		expect(splitFrontmatter('---\n- a\n- b\n---\nbody').data).toBe(null);
		expect(splitFrontmatter('---\n\n---\nbody').data).toEqual({});
	});
});
