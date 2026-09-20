import { ApiError, errorDetail } from '$lib/api/client';

export class SizeLimitError extends Error {
	constructor(
		readonly limit: number,
		readonly size: number | null
	) {
		super(`response exceeds ${limit} bytes`);
		this.name = 'SizeLimitError';
	}
}

export class RangeUnsupportedError extends Error {
	constructor() {
		super('server ignored the Range request');
		this.name = 'RangeUnsupportedError';
	}
}

export interface BoundedOptions {
	// Per-response byte limit.
	maxBytes: number;
	// Budget shared by every response of this fetcher.
	totalBytes?: number;
	// Base for relative urls and the only origin that receives the bearer.
	origin: string;
	token?: () => string | null | undefined;
	signal?: AbortSignal;
	fetch?: typeof fetch;
}

// A fetch for third-party parsers: bearer on the hub origin only, errors as ApiError, bodies capped.
export function boundedFetch({
	maxBytes,
	totalBytes = Infinity,
	origin,
	token,
	signal,
	fetch: fetchImpl = globalThis.fetch
}: BoundedOptions): typeof fetch {
	let spent = 0;
	return async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : input, origin);
		const headers = new Headers(input instanceof Request ? input.headers : undefined);
		new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
		const bearer = token?.();
		if (bearer && url.origin === origin) headers.set('authorization', `Bearer ${bearer}`);
		const res = await fetchImpl(url, { ...init, headers, signal: signal ?? init?.signal });
		if (!res.ok) throw new ApiError(res.status, await errorDetail(res), url.pathname);

		const length = res.headers.get('content-length');
		const size = length === null ? null : Number(length);
		const budget = Math.min(maxBytes, totalBytes - spent);
		if (headers.has('range') && res.status !== 206 && (size === null || size > budget)) {
			await res.body?.cancel();
			throw new RangeUnsupportedError();
		}
		if (size !== null && size > budget) {
			await res.body?.cancel();
			throw new SizeLimitError(budget, size);
		}
		if (!res.body) return res;

		let seen = 0;
		const limited = res.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					seen += chunk.byteLength;
					spent += chunk.byteLength;
					if (seen > maxBytes || spent > totalBytes) {
						controller.error(new SizeLimitError(Math.min(maxBytes, totalBytes), null));
					} else {
						controller.enqueue(chunk);
					}
				}
			})
		);
		return new Response(limited, {
			status: res.status,
			statusText: res.statusText,
			headers: res.headers
		});
	};
}
