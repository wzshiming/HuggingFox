import { describe, expect, it } from 'vitest';
import type { TreeEntry } from '$lib/api/types';
import { crumbs, fileKind, looksBinary, parentOf, sortEntries } from './kind.ts';

describe('fileKind', () => {
	it('classifies by extension or well-known name, never by content', () => {
		expect(fileKind('README.md')).toEqual({ kind: 'markdown', language: 'markdown' });
		expect(fileKind('docs/Guide.MD')).toEqual({ kind: 'markdown', language: 'markdown' });
		expect(fileKind('config.json')).toEqual({ kind: 'text', language: 'json' });
		expect(fileKind('model.safetensors.index.json')).toEqual({ kind: 'text', language: 'json' });
		expect(fileKind('train.py')).toEqual({ kind: 'text', language: 'python' });
		expect(fileKind('app.ts')).toEqual({ kind: 'text', language: 'typescript' });
		expect(fileKind('Dockerfile')).toEqual({ kind: 'text', language: 'dockerfile' });
		expect(fileKind('.gitattributes')).toEqual({ kind: 'text', language: null });
		expect(fileKind('LICENSE')).toEqual({ kind: 'text', language: null });
		expect(fileKind('data/train.csv')).toEqual({ kind: 'text', language: null });
		expect(fileKind('logo.png')).toEqual({ kind: 'image', mime: 'image/png' });
		expect(fileKind('icon.SVG')).toEqual({ kind: 'image', mime: 'image/svg+xml' });
		expect(fileKind('photo.jpeg')).toEqual({ kind: 'image', mime: 'image/jpeg' });
		expect(fileKind('model.safetensors')).toEqual({ kind: 'safetensors' });
		expect(fileKind('model-00001-of-00002.safetensors')).toEqual({ kind: 'safetensors' });
		expect(fileKind('llama.Q4_K_M.gguf')).toEqual({ kind: 'gguf' });
		expect(fileKind('pytorch_model.bin')).toEqual({ kind: 'binary' });
		expect(fileKind('data/train-00000-of-00001.parquet')).toEqual({ kind: 'binary' });
		expect(fileKind('tokenizer.model')).toEqual({ kind: 'binary' });
		expect(fileKind('paper.pdf')).toEqual({ kind: 'binary' });
		expect(fileKind('mystery.xyz')).toEqual({ kind: 'unknown' });
		expect(fileKind('noext')).toEqual({ kind: 'unknown' });
	});
});

describe('looksBinary', () => {
	it('flags NUL bytes and heavy decoding damage, keeps ordinary unicode text', () => {
		expect(looksBinary('hello\u0000world')).toBe(true);
		expect(looksBinary('\uFFFD\uFFFD\uFFFDab\uFFFD')).toBe(true);
		expect(looksBinary('日本語のテキスト and emoji 🦊\n')).toBe(false);
		expect(looksBinary('one stray \uFFFD in ' + 'x'.repeat(500))).toBe(false);
		expect(looksBinary('')).toBe(false);
	});
});

describe('paths', () => {
	it('splits a path into linkable crumbs and finds the parent folder', () => {
		expect(crumbs('')).toEqual([]);
		expect(crumbs('config.json')).toEqual([{ name: 'config.json', path: 'config.json' }]);
		expect(crumbs('a/b/c.txt')).toEqual([
			{ name: 'a', path: 'a' },
			{ name: 'b', path: 'a/b' },
			{ name: 'c.txt', path: 'a/b/c.txt' }
		]);
		expect(parentOf('a/b/c.txt')).toBe('a/b');
		expect(parentOf('c.txt')).toBe('');
		expect(parentOf('')).toBe(null);
	});
});

describe('sortEntries', () => {
	it('lists directories first and otherwise keeps the hub order', () => {
		const entry = (path: string, type: TreeEntry['type']) =>
			({ path, type, oid: path }) as TreeEntry;
		const sorted = sortEntries([
			entry('.gitattributes', 'file'),
			entry('README.md', 'file'),
			entry('assets', 'directory'),
			entry('config.json', 'file'),
			entry('onnx', 'directory')
		]);
		expect(sorted.map((e) => e.path)).toEqual([
			'assets',
			'onnx',
			'.gitattributes',
			'README.md',
			'config.json'
		]);
	});
});
