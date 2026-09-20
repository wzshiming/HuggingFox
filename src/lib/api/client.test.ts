import { describe, expect, it } from 'vitest';
import { ApiError, createClient } from './client.ts';

interface Call {
	url: URL;
	headers: Headers;
	signal: AbortSignal | null | undefined;
}

function fakeHub(
	respond: (call: Call) => Response | Promise<Response>,
	token?: () => string | null
) {
	const calls: Call[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		const call = { url: new URL(request.url), headers: request.headers, signal: init?.signal };
		calls.push(call);
		return respond(call);
	};
	return { calls, hub: createClient({ baseUrl: 'http://hub.test', fetch: fetchImpl, token }) };
}

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		...init,
		headers: { 'content-type': 'application/json', ...init.headers }
	});

describe('listRepos', () => {
	it('repeats filter values and uses bracketed expand projections', async () => {
		const { calls, hub } = fakeHub(() => json([{ id: 'google/bert' }]));
		const page = await hub.listRepos('model', {
			search: 'bert',
			author: 'google',
			filter: ['text-classification', 'pytorch'],
			sort: 'trendingScore',
			direction: -1,
			limit: 20,
			expand: ['downloads', 'likes']
		});
		expect(page.items).toEqual([{ id: 'google/bert' }]);
		expect(page.next).toBe(null);
		const { url, headers } = calls[0];
		expect(url.origin + url.pathname).toBe('http://hub.test/api/models');
		expect(url.searchParams.get('search')).toBe('bert');
		expect(url.searchParams.get('author')).toBe('google');
		expect(url.searchParams.getAll('filter')).toEqual(['text-classification', 'pytorch']);
		expect(url.searchParams.get('sort')).toBe('trendingScore');
		expect(url.searchParams.get('direction')).toBe('-1');
		expect(url.searchParams.get('limit')).toBe('20');
		expect(url.searchParams.getAll('expand[]')).toEqual(['downloads', 'likes']);
		expect(url.searchParams.has('expand')).toBe(false);
		expect(headers.get('accept')).toBe('application/json');
		expect(headers.has('authorization')).toBe(false);
	});

	it('tolerates sparse items and omits undefined params', async () => {
		const { calls, hub } = fakeHub(() => json([{ id: 'u/r' }, { id: 'u/s', likes: 3 }]));
		const page = await hub.listRepos('dataset', { search: undefined, limit: 5 });
		expect(page.items).toHaveLength(2);
		expect(calls[0].url.pathname).toBe('/api/datasets');
		expect([...calls[0].url.searchParams.keys()]).toEqual(['limit']);
	});
});

describe('pagination', () => {
	it('normalizes an absolute upstream Link and follows it on the same origin with the bearer', async () => {
		const { calls, hub } = fakeHub(
			(call) =>
				call.url.searchParams.has('cursor')
					? json([{ id: 'u/b' }])
					: json([{ id: 'u/a' }], {
							headers: {
								link: '<https://huggingface.co/api/spaces?cursor=eyJ%3D&limit=1>; rel="next"'
							}
						}),
			() => 'hf_secret'
		);
		const first = await hub.listRepos('space', { limit: 1 });
		expect(first.next).toBe('/api/spaces?cursor=eyJ%3D&limit=1');
		const second = await hub.page<{ id: string }>(first.next!);
		expect(second.items).toEqual([{ id: 'u/b' }]);
		expect(second.next).toBe(null);
		expect(calls[1].url.href).toBe('http://hub.test/api/spaces?cursor=eyJ%3D&limit=1');
		expect(calls[1].headers.get('authorization')).toBe('Bearer hf_secret');
	});

	it('drops a Link that points at a different endpoint', async () => {
		const { hub } = fakeHub(() =>
			json([], { headers: { link: '<https://huggingface.co/api/whoami-v2>; rel="next"' } })
		);
		expect((await hub.listRepos('model', {})).next).toBe(null);
	});

	it('refuses to send the bearer to a page outside the hub api', async () => {
		const { calls, hub } = fakeHub(
			() => json([]),
			() => 'hf_secret'
		);
		for (const bad of [
			'https://evil.example/api/models?cursor=1',
			'//evil.example/api/models',
			'/other/api/models',
			'api/models',
			''
		]) {
			await expect(hub.page(bad)).rejects.toThrow(/page/);
		}
		expect(calls).toHaveLength(0);
	});
});

describe('repo endpoints', () => {
	it('builds tree paths with encoded rev and path and keeps the cursor opaque', async () => {
		const { calls, hub } = fakeHub(() =>
			json([{ type: 'file', path: 'dir/sub dir/a.txt', oid: 'x', size: 1 }], {
				headers: {
					link: '</api/datasets/u/r/tree/refs%2Fpr%2F1/dir/sub%20dir?cursor=abc>; rel="next"'
				}
			})
		);
		const page = await hub.tree('dataset', 'u/r', 'refs/pr/1', 'dir/sub dir', {
			recursive: true,
			expand: true,
			limit: 100
		});
		expect(calls[0].url.pathname).toBe('/api/datasets/u/r/tree/refs%2Fpr%2F1/dir/sub%20dir');
		expect(calls[0].url.search).toBe('?recursive=true&expand=true&limit=100');
		expect(page.next).toBe('/api/datasets/u/r/tree/refs%2Fpr%2F1/dir/sub%20dir?cursor=abc');
		expect(page.items[0].path).toBe('dir/sub dir/a.txt');

		await hub.tree('model', 'gpt2', 'main');
		expect(calls[1].url.pathname + calls[1].url.search).toBe('/api/models/gpt2/tree/main');
	});

	it('reads X-Total-Count for commits', async () => {
		const { calls, hub } = fakeHub(() =>
			json([{ id: 'abc', title: 't', message: '', authors: [], date: '2026-01-01T00:00:00Z' }], {
				headers: { 'x-total-count': '123' }
			})
		);
		const page = await hub.commits('model', 'u/r', 'refs/pr/1', {
			p: 2,
			limit: 50,
			expand: ['formatted']
		});
		expect(page.total).toBe(123);
		expect(page.items[0].id).toBe('abc');
		expect(calls[0].url.pathname).toBe('/api/models/u/r/commits/refs%2Fpr%2F1');
		expect(calls[0].url.searchParams.get('p')).toBe('2');
		expect(calls[0].url.searchParams.get('limit')).toBe('50');
		expect(calls[0].url.searchParams.getAll('expand[]')).toEqual(['formatted']);

		const { hub: sparse } = fakeHub(() => json([{ id: 'abc' }]));
		const missing = await sparse.commits('model', 'u/r', 'main');
		expect(missing.total).toBe(null);
		expect(missing.items[0].id).toBe('abc');
	});

	it('requests info, refs and a bounded two-dot patch', async () => {
		const { calls, hub } = fakeHub((call) =>
			call.url.pathname.includes('/compare/')
				? new Response('diff --git a/x b/x', { headers: { 'content-type': 'text/plain' } })
				: json({ id: 'u/r' })
		);
		expect((await hub.info('model', 'u/r')).id).toBe('u/r');
		expect(calls[0].url.pathname + calls[0].url.search).toBe('/api/models/u/r');
		await hub.info('space', 'u/r', { revision: 'refs/pr/1', expand: ['runtime'] });
		expect(calls[1].url.pathname).toBe('/api/spaces/u/r/revision/refs%2Fpr%2F1');
		expect(calls[1].url.searchParams.getAll('expand[]')).toEqual(['runtime']);
		await hub.refs('model', 'u/r', { includePrs: true });
		expect(calls[2].url.pathname + calls[2].url.search).toBe('/api/models/u/r/refs?include_prs=1');
		expect(await hub.patch('model', 'u/r', 'refs/pr/1', 'main')).toEqual({
			text: 'diff --git a/x b/x',
			size: null,
			truncated: false
		});
		expect(calls[3].url.pathname + calls[3].url.search).toBe(
			'/api/models/u/r/compare/refs%2Fpr%2F1..main'
		);
	});
});

describe('errors and signals', () => {
	it('exposes status and detail from json or text error bodies', async () => {
		const { hub } = fakeHub(() => json({ error: 'Repository not found' }, { status: 404 }));
		const err = await hub.info('model', 'u/missing').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(404);
		expect(err.detail).toBe('Repository not found');
		expect(err.message).toContain('404');

		const { hub: text } = fakeHub(() => new Response('upstream exploded', { status: 502 }));
		const err2 = await text.info('model', 'u/r').catch((e) => e);
		expect(err2.status).toBe(502);
		expect(err2.detail).toBe('upstream exploded');
	});

	it('reads only the head of a streaming error body and cancels the rest', async () => {
		let pulls = 0;
		let cancelled = false;
		const body = new ReadableStream(
			{
				pull(controller) {
					pulls++;
					controller.enqueue(new Uint8Array(1024).fill(65));
				},
				cancel() {
					cancelled = true;
				}
			},
			{ highWaterMark: 0 }
		);
		const { hub } = fakeHub(() => new Response(body, { status: 500 }));
		const err = await hub.info('model', 'u/r').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(500);
		expect(err.detail).toBe('A'.repeat(200));
		expect(cancelled).toBe(true);
		// 8 KiB budget: eight full chunks plus the one that overflows it.
		expect(pulls).toBe(9);
	});

	it('takes the detail from X-Error-Message without reading the body', async () => {
		let pulls = 0;
		let cancelled = false;
		const body = new ReadableStream(
			{
				pull(controller) {
					pulls++;
					controller.enqueue(new Uint8Array(1024));
				},
				cancel() {
					cancelled = true;
				}
			},
			{ highWaterMark: 0 }
		);
		const { hub } = fakeHub(
			() => new Response(body, { status: 403, headers: { 'x-error-message': 'Access denied' } })
		);
		const err = await hub.info('model', 'u/r').catch((e) => e);
		expect(err.status).toBe(403);
		expect(err.detail).toBe('Access denied');
		expect(cancelled).toBe(true);
		expect(pulls).toBe(0);
	});

	it('forwards the abort signal to fetch', async () => {
		const { calls, hub } = fakeHub(() => json({ id: 'u/r' }));
		const controller = new AbortController();
		await hub.info('model', 'u/r', {}, { signal: controller.signal });
		expect(calls[0].signal).toBe(controller.signal);
	});

	it('preserves HTTP status and header detail when the error body has already failed', async () => {
		const body = new ReadableStream({
			start(controller) {
				controller.error(new TypeError('terminated'));
			}
		});
		const { hub } = fakeHub(
			() => new Response(body, { status: 403, headers: { 'x-error-message': 'Access denied' } })
		);
		const error = await hub.info('model', 'u/r').catch((error) => error);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.status).toBe(403);
		expect(error.detail).toBe('Access denied');
	});
});

describe('auth', () => {
	it('sends the current token to hub requests and lets whoami validate another token', async () => {
		const { calls, hub } = fakeHub(
			() => json({ type: 'user', name: 'alice' }),
			() => 'hf_current'
		);
		await hub.info('model', 'u/r');
		expect(calls[0].headers.get('authorization')).toBe('Bearer hf_current');
		const me = await hub.whoami({ token: 'hf_candidate' });
		expect(me.name).toBe('alice');
		expect(calls[1].url.pathname).toBe('/api/whoami-v2');
		expect(calls[1].headers.get('authorization')).toBe('Bearer hf_candidate');
	});

	it('sends no header when there is no token', async () => {
		const { calls, hub } = fakeHub(
			() => json({}),
			() => null
		);
		await hub.whoami().catch(() => undefined);
		expect(calls[0].headers.has('authorization')).toBe(false);
	});
});

describe('optional endpoints', () => {
	it.each([404, 405])('treats %i as unavailable for quicksearch and tags', async (status) => {
		const { hub } = fakeHub(() => new Response('', { status }));
		expect(await hub.quicksearch('bert', { limit: 5 })).toBe(null);
		expect(await hub.tagsByType('model')).toBe(null);
	});

	it.each([401, 403, 500, 503])('still throws on %i', async (status) => {
		const { hub } = fakeHub(() => new Response('', { status }));
		await expect(hub.quicksearch('bert')).rejects.toBeInstanceOf(ApiError);
		await expect(hub.tagsByType('dataset')).rejects.toBeInstanceOf(ApiError);
	});

	it('uses the hub query names', async () => {
		const { calls, hub } = fakeHub(() => json({ models: [], datasets: [], spaces: [] }));
		await hub.quicksearch('bert', { limit: 5, type: 'model' });
		expect(calls[0].url.pathname).toBe('/api/quicksearch');
		expect(calls[0].url.searchParams.get('q')).toBe('bert');
		expect(calls[0].url.searchParams.get('limit')).toBe('5');
		expect(calls[0].url.searchParams.get('type')).toBe('model');
		await hub.tagsByType('dataset');
		expect(calls[1].url.pathname).toBe('/api/datasets-tags-by-type');
	});

	it('reports a missing user as a 404 error instead of caching a fallback', async () => {
		const { calls, hub } = fakeHub((call) =>
			call.url.pathname.endsWith('/ghost/overview')
				? json({ error: 'Not found' }, { status: 404 })
				: json({ user: 'alice' })
		);
		const err = await hub.userOverview('ghost').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(404);
		expect((await hub.userOverview('alice')).user).toBe('alice');
		expect(calls.map((c) => c.url.pathname)).toEqual([
			'/api/users/ghost/overview',
			'/api/users/alice/overview'
		]);
	});
});

describe('text files', () => {
	it('resolves a file on the same origin with the bearer and reads it as text', async () => {
		const { calls, hub } = fakeHub(
			() => new Response('# hi\n', { headers: { 'content-length': '5' } }),
			() => 'hf_secret'
		);
		const file = await hub.text('dataset', 'u/r', 'main', 'docs/README.md', { maxBytes: 1024 });
		expect(file).toEqual({ text: '# hi\n', size: 5, truncated: false });
		expect(calls[0].url.pathname).toBe('/datasets/u/r/resolve/main/docs/README.md');
		expect(calls[0].headers.get('authorization')).toBe('Bearer hf_secret');
		expect(calls[0].headers.get('accept')).toContain('text/');
	});

	it('does not read a body whose declared length exceeds the limit', async () => {
		let read = false;
		const body = new ReadableStream(
			{
				pull(controller) {
					read = true;
					controller.enqueue(new Uint8Array(1024));
				}
			},
			{ highWaterMark: 0 }
		);
		const { hub } = fakeHub(() => new Response(body, { headers: { 'content-length': '3000000' } }));
		const file = await hub.text('model', 'u/r', 'main', 'model.bin', { maxBytes: 2 * 1024 * 1024 });
		expect(file).toEqual({ text: '', size: 3_000_000, truncated: true });
		expect(read).toBe(false);
	});

	it('cuts a multi-chunk body at the byte limit and stops pulling', async () => {
		let pulls = 0;
		let cancelled = false;
		const body = new ReadableStream(
			{
				pull(controller) {
					pulls++;
					controller.enqueue(new TextEncoder().encode('abcd'));
				},
				cancel() {
					cancelled = true;
				}
			},
			{ highWaterMark: 0 }
		);
		const { hub } = fakeHub(() => new Response(body));
		const file = await hub.text('model', 'u/r', 'main', 'README.md', { maxBytes: 10 });
		expect(file).toEqual({ text: 'abcdabcdab', size: null, truncated: true });
		expect(cancelled).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(pulls).toBe(3);
	});

	it.each([
		[4, 'ab'],
		[5, 'ab€']
	])('cuts one oversized chunk at %i bytes without splitting a character', async (max, text) => {
		let pulls = 0;
		let cancelled = false;
		const body = new ReadableStream(
			{
				start(controller) {
					controller.enqueue(new TextEncoder().encode('ab€cd'));
				},
				pull(controller) {
					pulls++;
					controller.enqueue(new TextEncoder().encode('!'));
				},
				cancel() {
					cancelled = true;
				}
			},
			{ highWaterMark: 0 }
		);
		const { hub } = fakeHub(() => new Response(body));
		const file = await hub.text('model', 'u/r', 'main', 'README.md', { maxBytes: max });
		expect(file).toEqual({ text, size: null, truncated: true });
		expect(new TextEncoder().encode(file.text).byteLength).toBeLessThanOrEqual(max);
		expect(cancelled).toBe(true);
		expect(pulls).toBe(0);
	});

	it('does not flag a body that ends exactly at the limit', async () => {
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('ab'));
				controller.enqueue(new TextEncoder().encode('€'));
				controller.close();
			}
		});
		const { hub } = fakeHub(() => new Response(body));
		const file = await hub.text('model', 'u/r', 'main', 'README.md', { maxBytes: 5 });
		expect(file).toEqual({ text: 'ab€', size: null, truncated: false });
	});

	it('surfaces a missing file as an ApiError', async () => {
		const { hub } = fakeHub(() => json({ error: 'Entry not found' }, { status: 404 }));
		const err = await hub.text('model', 'u/r', 'main', 'README.md').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(404);
		expect(err.path).toBe('/u/r/resolve/main/README.md');
	});
});

describe('paths-info and patches', () => {
	it('posts the paths as json to the hub paths-info endpoint', async () => {
		const bodies: string[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			bodies.push(String(init?.body));
			const request = new Request(input, init);
			expect(request.method).toBe('POST');
			expect(request.headers.get('content-type')).toBe('application/json');
			expect(request.headers.get('authorization')).toBe('Bearer hf_x');
			expect(request.url).toBe('http://hub.test/api/datasets/u/r/paths-info/refs%2Fpr%2F1');
			return json([{ type: 'file', path: 'dir/a.txt', oid: 'o', size: 3 }]);
		};
		const hub = createClient({ baseUrl: 'http://hub.test', fetch: fetchImpl, token: () => 'hf_x' });
		const entries = await hub.pathsInfo('dataset', 'u/r', 'refs/pr/1', ['dir/a.txt'], {
			expand: true
		});
		expect(entries).toEqual([{ type: 'file', path: 'dir/a.txt', oid: 'o', size: 3 }]);
		expect(JSON.parse(bodies[0])).toEqual({ paths: ['dir/a.txt'], expand: true });
	});

	it('fetches a bounded plain-text patch for a first-parent compare', async () => {
		const { calls, hub } = fakeHub(
			() =>
				new Response('diff --git a/x b/x\n', {
					headers: { 'content-type': 'text/plain', 'content-length': '19' }
				})
		);
		const sha = '607a30d783dfa663caf39e06633721c8d4cfcd7e';
		const file = await hub.patch('model', 'u/r', `${sha}^`, sha, { maxBytes: 1024 });
		expect(file).toEqual({ text: 'diff --git a/x b/x\n', size: 19, truncated: false });
		expect(calls[0].url.pathname).toBe(`/api/models/u/r/compare/${sha}%5E..${sha}`);
		expect(calls[0].url.search).toBe('');
		expect(calls[0].headers.get('accept')).toContain('text/plain');
	});

	it('does not read a patch whose declared length exceeds the limit', async () => {
		const { hub } = fakeHub(
			() => new Response('x'.repeat(50), { headers: { 'content-length': '50' } })
		);
		const file = await hub.patch('model', 'u/r', 'a^', 'a', { maxBytes: 10 });
		expect(file).toEqual({ text: '', size: 50, truncated: true });
	});

	it('unwraps a json-encoded patch string', async () => {
		const { hub } = fakeHub(() => json('diff --git a/y b/y\n'));
		const file = await hub.patch('model', 'u/r', 'a^', 'a');
		expect(file.text).toBe('diff --git a/y b/y\n');
	});
});

describe('repository management', () => {
	interface Sent {
		method: string;
		path: string;
		body: unknown;
		auth: string | null;
		contentType: string | null;
		signal: AbortSignal | null | undefined;
	}

	function fakeWriter(respond: (sent: Sent) => Response) {
		const sent: Sent[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			const text = await request.text();
			const call = {
				method: request.method,
				path: new URL(request.url).pathname,
				body: text ? JSON.parse(text) : null,
				auth: request.headers.get('authorization'),
				contentType: request.headers.get('content-type'),
				signal: init?.signal
			};
			sent.push(call);
			return respond(call);
		};
		return { sent, hub: createClient({ baseUrl: 'http://hub.test', fetch: fetchImpl }) };
	}

	it('creates a public repo with the hub body and accepts an empty reply', async () => {
		const { sent, hub } = fakeWriter(() => new Response(null, { status: 200 }));
		await hub.createRepo('dataset', 'org/new-set', {}, { token: 'hf_write' });
		expect(sent[0]).toMatchObject({
			method: 'POST',
			path: '/api/repos/create',
			body: { type: 'dataset', name: 'new-set', organization: 'org', private: false },
			auth: 'Bearer hf_write',
			contentType: 'application/json'
		});
	});

	it('sends the space sdk only for spaces', async () => {
		const { sent, hub } = fakeWriter(() => json({ url: 'https://hub.test/spaces/u/app' }));
		await hub.createRepo('space', 'u/app', { sdk: 'gradio' }, { token: 'hf_write' });
		expect(sent[0].body).toEqual({
			type: 'space',
			name: 'app',
			organization: 'u',
			private: false,
			sdk: 'gradio'
		});
		await hub.createRepo('model', 'u/m', { sdk: 'gradio' }, { token: 'hf_write' });
		expect(sent[1].body).not.toHaveProperty('sdk');
	});

	it('deletes with the hub body and surfaces the status', async () => {
		const { sent, hub } = fakeWriter((call) =>
			call.body && (call.body as { name: string }).name === 'gone'
				? new Response(null, { status: 200 })
				: json({ error: 'Forbidden' }, { status: 403 })
		);
		const controller = new AbortController();
		await hub.deleteRepo('model', 'u/gone', { token: 'hf_write', signal: controller.signal });
		expect(sent[0]).toMatchObject({
			method: 'DELETE',
			path: '/api/repos/delete',
			body: { type: 'model', name: 'gone', organization: 'u' },
			auth: 'Bearer hf_write'
		});
		expect(sent[0].signal).toBe(controller.signal);
		const err = await hub.deleteRepo('model', 'u/kept', { token: 'hf_write' }).catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(403);
	});

	it('moves a repo with the hub json names and reports a conflict', async () => {
		const { sent, hub } = fakeWriter((call) =>
			(call.body as { toRepo: string }).toRepo === 'u/taken'
				? json({ error: 'destination repository already exists' }, { status: 409 })
				: new Response(null, { status: 200 })
		);
		await hub.moveRepo('space', 'u/old', 'u/new', { token: 'hf_write' });
		expect(sent[0]).toMatchObject({
			method: 'POST',
			path: '/api/repos/move',
			body: { fromRepo: 'u/old', toRepo: 'u/new', type: 'space' },
			auth: 'Bearer hf_write',
			contentType: 'application/json'
		});
		const err = await hub
			.moveRepo('space', 'u/old', 'u/taken', { token: 'hf_write' })
			.catch((e) => e);
		expect(err.status).toBe(409);
		expect(err.detail).toContain('already exists');
	});

	it('refuses ids that are not owner/name', async () => {
		const { sent, hub } = fakeWriter(() => new Response(null, { status: 200 }));
		for (const bad of ['gpt2', 'a/b/c', '/x', 'x/']) {
			await expect(hub.createRepo('model', bad, {}, { token: 'hf_write' })).rejects.toThrow(
				/owner/
			);
			await expect(hub.deleteRepo('model', bad, { token: 'hf_write' })).rejects.toThrow(/owner/);
		}
		await expect(hub.moveRepo('model', 'u/a', 'b', { token: 'hf_write' })).rejects.toThrow(/owner/);
		expect(sent).toHaveLength(0);
	});
});
