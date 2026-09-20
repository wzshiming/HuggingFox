import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import { boundedFetch, RangeUnsupportedError } from './fetch.ts';
import { loadSafetensors, tensorRows } from './safetensors.ts';
import { rangeReply, tinySafetensors, tinySafetensorsHeader } from './testing.ts';

const origin = 'http://hub.test';

function serve(files: Record<string, Uint8Array<ArrayBuffer> | number>, honourRange = true) {
	const requests: { url: URL; range: string | null; auth: string | null }[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		requests.push({
			url,
			range: request.headers.get('range'),
			auth: request.headers.get('authorization')
		});
		const file = files[url.pathname];
		if (file === undefined) {
			return new Response(JSON.stringify({ error: 'Entry not found' }), {
				status: 404,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (typeof file === 'number') {
			return new Response(JSON.stringify({ error: 'nope' }), {
				status: file,
				headers: { 'content-type': 'application/json' }
			});
		}
		const reply = rangeReply(file, honourRange ? request.headers.get('range') : null);
		return new Response(reply.body, { status: reply.status, headers: reply.headers });
	};
	return { requests, fetchImpl };
}

describe('tensorRows', () => {
	it('lists tensors in header order with byte sizes and separates the metadata', () => {
		const view = tensorRows(tinySafetensorsHeader as never);
		expect(view.metadata).toEqual([['format', 'pt']]);
		expect(view.tensors).toEqual([
			{ name: 'model.embed.weight', dtype: 'F32', shape: [2, 3], bytes: 24 },
			{ name: 'model.norm.bias', dtype: 'BF16', shape: [4], bytes: 8 }
		]);
	});
});

describe('loadSafetensors', () => {
	it('reads only the header through ranged requests on the hub origin', async () => {
		const { requests, fetchImpl } = serve({
			'/datasets/u/r/resolve/main/weights/model.safetensors': tinySafetensors()
		});
		const summary = await loadSafetensors(
			{ type: 'dataset', id: 'u/r', rev: 'main', path: 'weights/model.safetensors' },
			{
				origin,
				fetch: boundedFetch({ maxBytes: 1024, origin, fetch: fetchImpl, token: () => 'tok' })
			}
		);
		expect(summary.tensors.map((t) => t.name)).toEqual(['model.embed.weight', 'model.norm.bias']);
		expect(summary.parameterCount).toEqual({ F32: 6, BF16: 4 });
		expect(summary.parameterTotal).toBe(10);
		expect(summary.metadata).toEqual([['format', 'pt']]);
		expect(summary.truncated).toBe(false);
		const weights = requests.filter((r) => r.url.pathname.endsWith('model.safetensors'));
		expect(weights.length).toBeGreaterThan(0);
		expect(weights.every((r) => r.range !== null)).toBe(true);
		expect(weights.every((r) => r.auth === 'Bearer tok')).toBe(true);
		expect(requests.every((r) => r.url.origin === origin)).toBe(true);
	});

	it('escapes each path segment once so #, ?, % and spaces reach the hub literally', async () => {
		const path = 'my weights/50% done/a#b?c.safetensors';
		const encoded = '/u/r/resolve/main/my%20weights/50%25%20done/a%23b%3Fc.safetensors';
		const { requests, fetchImpl } = serve({ [encoded]: tinySafetensors() });
		const summary = await loadSafetensors(
			{ type: 'model', id: 'u/r', rev: 'main', path },
			{ origin, fetch: boundedFetch({ maxBytes: 1024, origin, fetch: fetchImpl }) }
		);
		expect(summary.tensorCount).toBe(2);
		const weights = requests.filter((r) => r.url.pathname.endsWith('.safetensors'));
		expect(weights.length).toBeGreaterThan(0);
		expect(weights.every((r) => r.url.pathname === encoded)).toBe(true);
		expect(weights.every((r) => r.url.search === '' && r.url.hash === '')).toBe(true);
	});

	it('surfaces missing files and servers that ignore Range without downloading bodies', async () => {
		const missing = serve({});
		await expect(
			loadSafetensors(
				{ type: 'model', id: 'u/r', rev: 'main', path: 'model.safetensors' },
				{ origin, fetch: boundedFetch({ maxBytes: 1024, origin, fetch: missing.fetchImpl }) }
			)
		).rejects.toBeInstanceOf(ApiError);

		const big = new Uint8Array(4096);
		big.set(tinySafetensors());
		const noRange = serve({ '/u/r/resolve/main/model.safetensors': big }, false);
		await expect(
			loadSafetensors(
				{ type: 'model', id: 'u/r', rev: 'main', path: 'model.safetensors' },
				{ origin, fetch: boundedFetch({ maxBytes: 1024, origin, fetch: noRange.fetchImpl }) }
			)
		).rejects.toBeInstanceOf(RangeUnsupportedError);
	});

	it('reports malformed headers honestly', async () => {
		const junk = new Uint8Array(64).fill(255);
		const { fetchImpl } = serve({ '/u/r/resolve/main/model.safetensors': junk });
		await expect(
			loadSafetensors(
				{ type: 'model', id: 'u/r', rev: 'main', path: 'model.safetensors' },
				{ origin, fetch: boundedFetch({ maxBytes: 1024, origin, fetch: fetchImpl }) }
			)
		).rejects.toThrow(/header/i);
	});
});
