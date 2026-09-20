import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import { boundedFetch, RangeUnsupportedError, SizeLimitError } from './fetch.ts';

interface Call {
	url: string;
	headers: Headers;
	signal: AbortSignal | null | undefined;
}

function fake(respond: (call: Call) => Response) {
	const calls: Call[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		const call = { url: request.url, headers: request.headers, signal: init?.signal };
		calls.push(call);
		return respond(call);
	};
	return { calls, fetchImpl };
}

const origin = 'http://hub.test';
const bytes = (n: number) => new Uint8Array(n).fill(65);

// A body that streams `count` chunks of `size` bytes and records whether it was cancelled.
function streaming(count: number, size: number) {
	const state = { cancelled: false, pulled: 0 };
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (state.pulled++ >= count) controller.close();
			else controller.enqueue(bytes(size));
		},
		cancel() {
			state.cancelled = true;
		}
	});
	return { body, state };
}

describe('boundedFetch', () => {
	it('sends the bearer to the hub origin only and forwards the abort signal', async () => {
		const { calls, fetchImpl } = fake(() => new Response('ok'));
		const controller = new AbortController();
		const fetcher = boundedFetch({
			maxBytes: 100,
			origin,
			token: () => 'hf_secret',
			signal: controller.signal,
			fetch: fetchImpl
		});
		await fetcher('/u/r/resolve/main/a.txt', { headers: { accept: 'text/plain' } });
		await fetcher(`${origin}/u/r/resolve/main/b.txt`);
		await fetcher('https://cdn.example/blob');
		expect(calls.map((c) => c.url)).toEqual([
			`${origin}/u/r/resolve/main/a.txt`,
			`${origin}/u/r/resolve/main/b.txt`,
			'https://cdn.example/blob'
		]);
		expect(calls[0].headers.get('authorization')).toBe('Bearer hf_secret');
		expect(calls[0].headers.get('accept')).toBe('text/plain');
		expect(calls[1].headers.get('authorization')).toBe('Bearer hf_secret');
		expect(calls[2].headers.has('authorization')).toBe(false);
		expect(calls.every((c) => c.signal === controller.signal)).toBe(true);
	});

	it('turns error statuses into ApiError', async () => {
		const { fetchImpl } = fake(
			() =>
				new Response(JSON.stringify({ error: 'Repository not found' }), {
					status: 404,
					headers: { 'content-type': 'application/json' }
				})
		);
		const fetcher = boundedFetch({ maxBytes: 10, origin, fetch: fetchImpl });
		const error = await fetcher('/u/r/resolve/main/x').catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.status).toBe(404);
		expect(error.detail).toBe('Repository not found');
		expect(error.path).toBe('/u/r/resolve/main/x');
	});

	it('does not download a large error body to report the status', async () => {
		// 4 MiB of 500 in 64 KiB chunks against a 1 KiB fetcher.
		const body = streaming(64, 64 * 1024);
		const { fetchImpl } = fake(() => new Response(body.body, { status: 500 }));
		const fetcher = boundedFetch({ maxBytes: 1024, origin, fetch: fetchImpl });
		const error = await fetcher('/u/r/resolve/main/x').catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.status).toBe(500);
		expect(error.detail).toBe('A'.repeat(200));
		expect(body.state.cancelled).toBe(true);
		expect(body.state.pulled).toBeLessThanOrEqual(2);
	});

	it('refuses a full response to a range request unless it is provably small', async () => {
		const big = streaming(10, 10);
		const { fetchImpl } = fake((call) =>
			call.url.endsWith('/big')
				? new Response(big.body, { status: 200 })
				: new Response(bytes(4), { status: 200, headers: { 'content-length': '4' } })
		);
		const fetcher = boundedFetch({ maxBytes: 50, origin, fetch: fetchImpl });
		await expect(fetcher('/big', { headers: { range: 'bytes=0-7' } })).rejects.toBeInstanceOf(
			RangeUnsupportedError
		);
		expect(big.state.cancelled).toBe(true);
		const small = await fetcher('/small', { headers: { range: 'bytes=0-7' } });
		expect(new Uint8Array(await small.arrayBuffer())).toHaveLength(4);
	});

	it('keeps partial responses intact', async () => {
		const { fetchImpl } = fake(
			() =>
				new Response(bytes(8), {
					status: 206,
					headers: { 'content-range': 'bytes 0-7/1000', etag: '"abc"', 'content-length': '8' }
				})
		);
		const fetcher = boundedFetch({ maxBytes: 50, origin, fetch: fetchImpl });
		const res = await fetcher('/file', { headers: { range: 'bytes=0-7' } });
		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toBe('bytes 0-7/1000');
		expect(res.headers.get('etag')).toBe('"abc"');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes(8));
	});

	it('rejects a declared length over the limit without reading the body', async () => {
		const body = streaming(100, 10);
		const { fetchImpl } = fake(
			() => new Response(body.body, { headers: { 'content-length': '1000' } })
		);
		const fetcher = boundedFetch({ maxBytes: 100, origin, fetch: fetchImpl });
		const error = await fetcher('/file').catch((e) => e);
		expect(error).toBeInstanceOf(SizeLimitError);
		expect(error.limit).toBe(100);
		expect(body.state.cancelled).toBe(true);
		expect(body.state.pulled).toBeLessThanOrEqual(1);
	});

	it('cuts an undeclared stream that grows past the limit', async () => {
		const body = streaming(100, 10);
		const { fetchImpl } = fake(() => new Response(body.body));
		const fetcher = boundedFetch({ maxBytes: 35, origin, fetch: fetchImpl });
		const res = await fetcher('/file');
		await expect(res.arrayBuffer()).rejects.toBeInstanceOf(SizeLimitError);
		expect(body.state.cancelled).toBe(true);
		expect(body.state.pulled).toBeLessThan(10);
	});

	it('enforces a total budget across calls', async () => {
		const { fetchImpl } = fake((call) =>
			call.url.endsWith('/stream')
				? new Response(streaming(3, 10).body)
				: new Response(bytes(30), { headers: { 'content-length': '30' } })
		);
		const fetcher = boundedFetch({ maxBytes: 50, totalBytes: 70, origin, fetch: fetchImpl });
		await (await fetcher('/a')).arrayBuffer();
		await expect((await fetcher('/stream')).arrayBuffer()).resolves.toBeDefined();
		await expect(fetcher('/c')).rejects.toBeInstanceOf(SizeLimitError);
		await expect((await fetcher('/stream')).arrayBuffer()).rejects.toBeInstanceOf(SizeLimitError);
	});
});
