import { describe, expect, it } from 'vitest';
import {
	blobPagePath,
	commitPagePath,
	commitsPagePath,
	downloadPath,
	encodeRev,
	encodeSegments,
	listPagePath,
	nextPagePath,
	parseLinkHeader,
	repoApiPath,
	repoPagePath,
	repoTypeOf,
	resolvePath,
	splitRevPath,
	treePagePath
} from './url.ts';

describe('encoding', () => {
	it('encodes each path segment but keeps the separators', () => {
		expect(encodeSegments('dir/sub dir/a?b#c.json')).toBe('dir/sub%20dir/a%3Fb%23c.json');
		expect(encodeSegments('')).toBe('');
	});

	it('encodes a revision as one opaque segment', () => {
		expect(encodeRev('refs/pr/1')).toBe('refs%2Fpr%2F1');
		expect(encodeRev('main')).toBe('main');
		expect(encodeRev('v1.0#rc?x')).toBe('v1.0%23rc%3Fx');
	});
});

describe('api paths', () => {
	it('maps repo types to the HF api namespaces', () => {
		expect(repoApiPath('model', 'openai-community/gpt2')).toBe('/api/models/openai-community/gpt2');
		expect(repoApiPath('dataset', 'squad')).toBe('/api/datasets/squad');
		expect(repoApiPath('space', 'user/my app')).toBe('/api/spaces/user/my%20app');
	});
});

describe('page paths', () => {
	it('omits the prefix for models only', () => {
		expect(repoPagePath('model', 'openai-community/gpt2')).toBe('/openai-community/gpt2');
		expect(repoPagePath('dataset', 'user/repo')).toBe('/datasets/user/repo');
		expect(repoPagePath('space', 'user/repo')).toBe('/spaces/user/repo');
		expect(listPagePath('model')).toBe('/models');
		expect(listPagePath('dataset')).toBe('/datasets');
		expect(listPagePath('space')).toBe('/spaces');
		expect(repoTypeOf('datasets')).toBe('dataset');
		expect(repoTypeOf('spaces')).toBe('space');
		expect(repoTypeOf('models')).toBe('model');
		expect(repoTypeOf(undefined)).toBe('model');
	});

	it('builds tree, blob, commits and resolve urls with encoded rev and path', () => {
		expect(treePagePath('model', 'u/r', 'main')).toBe('/u/r/tree/main');
		expect(treePagePath('model', 'u/r', 'refs/pr/1', 'dir/sub')).toBe(
			'/u/r/tree/refs%2Fpr%2F1/dir/sub'
		);
		expect(blobPagePath('dataset', 'u/r', 'main', 'data/train 1.csv')).toBe(
			'/datasets/u/r/blob/main/data/train%201.csv'
		);
		expect(commitsPagePath('space', 'u/r', 'refs/pr/2')).toBe('/spaces/u/r/commits/refs%2Fpr%2F2');
		expect(resolvePath('model', 'u/r', 'main', 'config.json')).toBe(
			'/u/r/resolve/main/config.json'
		);
	});

	it('builds commit and download urls', () => {
		expect(commitPagePath('model', 'u/r', '607a30d783dfa663caf39e06633721c8d4cfcd7e')).toBe(
			'/u/r/commit/607a30d783dfa663caf39e06633721c8d4cfcd7e'
		);
		expect(commitPagePath('dataset', 'u/r', 'abc^')).toBe('/datasets/u/r/commit/abc%5E');
		expect(downloadPath('model', 'u/r', 'refs/pr/1', 'dir/a b.bin')).toBe(
			'/u/r/resolve/refs%2Fpr%2F1/dir/a%20b.bin?download=true'
		);
	});
});

describe('splitRevPath', () => {
	const refs = ['main', 'refs/pr/1', 'refs/pr/10', 'release/v1', 'release/v1/hotfix'];

	it('takes the longest known ref as the revision', () => {
		expect(splitRevPath('refs/pr/1/dir/file.txt', refs)).toEqual({
			rev: 'refs/pr/1',
			path: 'dir/file.txt'
		});
		expect(splitRevPath('refs/pr/10', refs)).toEqual({ rev: 'refs/pr/10', path: '' });
		expect(splitRevPath('release/v1/hotfix/x', refs)).toEqual({
			rev: 'release/v1/hotfix',
			path: 'x'
		});
		expect(splitRevPath('release/v1/x', refs)).toEqual({ rev: 'release/v1', path: 'x' });
	});

	it('falls back to the first segment when no ref matches', () => {
		expect(splitRevPath('abc123/dir/file', refs)).toEqual({ rev: 'abc123', path: 'dir/file' });
		expect(splitRevPath('main', [])).toEqual({ rev: 'main', path: '' });
		expect(splitRevPath('', refs)).toEqual({ rev: '', path: '' });
	});

	it('requires a segment boundary after the ref', () => {
		expect(splitRevPath('refs/pr/100/x', refs)).toEqual({ rev: 'refs', path: 'pr/100/x' });
		expect(splitRevPath('release/v10/x', ['release/v1'])).toEqual({
			rev: 'release',
			path: 'v10/x'
		});
	});
});

describe('Link pagination', () => {
	it('parses rel links', () => {
		expect(
			parseLinkHeader('<https://huggingface.co/api/models?cursor=abc&limit=20>; rel="next"')
		).toEqual({ next: 'https://huggingface.co/api/models?cursor=abc&limit=20' });
		expect(parseLinkHeader('</a?x=1>; rel=prev, </a?x=3>; rel="next"')).toEqual({
			prev: '/a?x=1',
			next: '/a?x=3'
		});
		expect(parseLinkHeader(null)).toEqual({});
	});

	it('normalizes an absolute upstream next link to the same endpoint path and query', () => {
		const link = '<https://huggingface.co/api/models?cursor=eyJ%3D&limit=20>; rel="next"';
		expect(nextPagePath(link, '/api/models')).toBe('/api/models?cursor=eyJ%3D&limit=20');
	});

	it('keeps a relative next link untouched', () => {
		const link = '</api/models/u/r/tree/main/dir?cursor=abc>; rel="next"';
		expect(nextPagePath(link, '/api/models/u/r/tree/main/dir')).toBe(
			'/api/models/u/r/tree/main/dir?cursor=abc'
		);
	});

	it('rejects a next link that points at another path or origin', () => {
		expect(nextPagePath('<https://evil.example/api/models?x=1>; rel="next"', '/api/models')).toBe(
			'/api/models?x=1'
		);
		expect(nextPagePath('<https://huggingface.co/api/whoami-v2>; rel="next"', '/api/models')).toBe(
			null
		);
		expect(nextPagePath('</other?x=1>; rel="next"', '/api/models')).toBe(null);
		expect(nextPagePath('<//evil.example/api/models?x=1>; rel="next"', '/api/models')).toBe(
			'/api/models?x=1'
		);
		expect(nextPagePath('</api/models?x=1>; rel="prev"', '/api/models')).toBe(null);
		expect(nextPagePath(null, '/api/models')).toBe(null);
	});
});
