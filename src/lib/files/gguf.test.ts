import { describe, expect, it } from 'vitest';
import { boundedFetch } from './fetch.ts';
import { displayValue, loadGguf } from './gguf.ts';
import { rangeReply, tinyGguf } from './testing.ts';

const origin = 'http://hub.test';
const url = `${origin}/u/r/resolve/main/tiny.gguf`;

function serve(bytes: Uint8Array<ArrayBuffer>) {
	const ranges: (string | null)[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		ranges.push(request.headers.get('range'));
		const reply = rangeReply(bytes, request.headers.get('range'));
		return new Response(reply.body, { status: reply.status, headers: reply.headers });
	};
	return { ranges, fetchImpl };
}

describe('displayValue', () => {
	it('renders scalars plainly and summarizes arrays', () => {
		expect(displayValue('llama')).toBe('llama');
		expect(displayValue(32000)).toBe('32000');
		expect(displayValue(2n ** 40n)).toBe('1099511627776');
		expect(displayValue(true)).toBe('true');
		expect(displayValue(['<s>', 'hello', 'world'])).toBe('[3] <s>, hello, world');
		expect(displayValue(Array.from({ length: 12 }, (_, i) => i))).toBe(
			'[12] 0, 1, 2, 3, 4, 5, 6, 7, …'
		);
	});
});

describe('loadGguf', () => {
	it('parses the header through ranged requests and names quantization types', async () => {
		const { ranges, fetchImpl } = serve(tinyGguf());
		const summary = await loadGguf(url, {
			fetch: boundedFetch({ maxBytes: 4 * 1024 * 1024, origin, fetch: fetchImpl })
		});
		expect(summary.version).toBe(3);
		expect(summary.architecture).toBe('llama');
		expect(summary.name).toBe('tiny-fixture');
		expect(summary.tensorCount).toBe(1);
		expect(summary.parameterCount).toBe(6);
		expect(summary.tensors).toEqual([
			{ name: 'blk.0.attn_q.weight', shape: '2 × 3', dtype: 'F32' }
		]);
		expect(summary.kv.find((e) => e.key === 'tokenizer.ggml.tokens')?.value).toBe(
			'[3] <s>, hello, world'
		);
		expect(summary.kv.find((e) => e.key === 'llama.block_count')?.value).toBe('2');
		expect(summary.kv.some((e) => e.key === 'version')).toBe(false);
		expect(ranges.length).toBeGreaterThan(0);
		expect(ranges.every((r) => r?.startsWith('bytes='))).toBe(true);
	});

	it('rejects files that are not GGUF', async () => {
		const { fetchImpl } = serve(new Uint8Array(64).fill(1));
		await expect(
			loadGguf(url, {
				fetch: boundedFetch({ maxBytes: 4 * 1024 * 1024, origin, fetch: fetchImpl })
			})
		).rejects.toThrow(/gguf/i);
	});
});
