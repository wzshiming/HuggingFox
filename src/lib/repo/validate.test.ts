import { describe, expect, it } from 'vitest';
import { joinPath, validateFilePath, validateRepoName } from './validate.ts';

describe('validateRepoName', () => {
	it('accepts hub-style names', () => {
		for (const name of ['gpt2', 'bert-base_uncased.v2', '_private', 'a', 'x'.repeat(96), '1.0']) {
			expect(validateRepoName(name)).toBe(null);
		}
	});

	it('rejects the names the hub rejects', () => {
		expect(validateRepoName('')).toBe('empty');
		expect(validateRepoName(' ')).toBe('empty');
		expect(validateRepoName('x'.repeat(97))).toBe('length');
		for (const name of ['-lead', '.lead', 'trail-', 'trail.', 'a b', 'ä', 'a/b', 'a\\b', 'a@b']) {
			expect(validateRepoName(name)).toBe('chars');
		}
		expect(validateRepoName('a--b')).toBe('double');
		expect(validateRepoName('a..b')).toBe('double');
		expect(validateRepoName('repo.git')).toBe('git');
	});
});

describe('validateFilePath', () => {
	it('accepts relative unicode paths', () => {
		for (const path of [
			'README.md',
			'docs/usage.md',
			'données/été.txt',
			'a b/c.txt',
			'.gitattributes'
		]) {
			expect(validateFilePath(path)).toBe(null);
		}
	});

	it('rejects empty, absolute, traversal and control characters', () => {
		expect(validateFilePath('')).toBe('empty');
		expect(validateFilePath('  ')).toBe('empty');
		for (const path of [
			'/etc/passwd',
			'C:\\x',
			'a\\b',
			'a//b',
			'dir/',
			'./a',
			'../a',
			'a/../b',
			'a/./b',
			'a\u0000b',
			'a\nb'
		]) {
			expect(validateFilePath(path)).toBe('invalid');
		}
	});
});

describe('joinPath', () => {
	it('joins a folder prefix and a relative name without doubling slashes', () => {
		expect(joinPath('', 'a.txt')).toBe('a.txt');
		expect(joinPath('docs', 'a.txt')).toBe('docs/a.txt');
		expect(joinPath('docs/', 'sub/a.txt')).toBe('docs/sub/a.txt');
		expect(joinPath('/docs/', '/a.txt')).toBe('docs/a.txt');
	});
});
