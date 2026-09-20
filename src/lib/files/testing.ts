// Tiny, spec-conformant safetensors / GGUF files plus a Range-aware responder shared by unit tests and e2e fixtures.

const encoder = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

function u64(value: number): Bytes {
	const out = new Uint8Array(8);
	new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
	return out;
}

function u32(value: number): Bytes {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value, true);
	return out;
}

function concat(parts: Uint8Array[]): Bytes {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.byteLength;
	}
	return out;
}

export const tinySafetensorsHeader = {
	__metadata__: { format: 'pt' },
	'model.embed.weight': { dtype: 'F32', shape: [2, 3], data_offsets: [0, 24] },
	'model.norm.bias': { dtype: 'BF16', shape: [4], data_offsets: [24, 32] }
};

// 8-byte little-endian header length, JSON header, then the raw tensor bytes.
export function tinySafetensors(header: object = tinySafetensorsHeader): Bytes {
	const json = encoder.encode(JSON.stringify(header));
	return concat([u64(json.byteLength), json, new Uint8Array(32)]);
}

function ggufString(text: string): Bytes {
	const bytes = encoder.encode(text);
	return concat([u64(bytes.byteLength), bytes]);
}

const GGUF_STRING = 8;
const GGUF_ARRAY = 9;
const GGUF_UINT32 = 4;

// GGUF v3, little-endian: magic, version, counts, key/value pairs, one F32 tensor, alignment padding.
export function tinyGguf(): Bytes {
	const kv = [
		concat([ggufString('general.architecture'), u32(GGUF_STRING), ggufString('llama')]),
		concat([ggufString('general.name'), u32(GGUF_STRING), ggufString('tiny-fixture')]),
		concat([ggufString('llama.block_count'), u32(GGUF_UINT32), u32(2)]),
		concat([
			ggufString('tokenizer.ggml.tokens'),
			u32(GGUF_ARRAY),
			u32(GGUF_STRING),
			u64(3),
			ggufString('<s>'),
			ggufString('hello'),
			ggufString('world')
		])
	];
	const tensor = concat([
		ggufString('blk.0.attn_q.weight'),
		u32(2),
		u64(2),
		u64(3),
		u32(0),
		u64(0)
	]);
	const head = concat([encoder.encode('GGUF'), u32(3), u64(1), u64(kv.length), ...kv, tensor]);
	const padded = Math.ceil(head.byteLength / 32) * 32;
	return concat([head, new Uint8Array(padded - head.byteLength + 24)]);
}

export interface RangeReply {
	status: number;
	headers: Record<string, string>;
	body: Bytes;
}

// Answers `Range: bytes=a-b` like a CDN would: 206 + Content-Range, or the whole file without Range.
export function rangeReply(
	bytes: Bytes,
	range: string | null,
	type = 'application/octet-stream'
): RangeReply {
	const headers: Record<string, string> = {
		'content-type': type,
		etag: `"${bytes.byteLength.toString(16)}"`,
		'accept-ranges': 'bytes'
	};
	const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
	if (!match) {
		return {
			status: 200,
			headers: { ...headers, 'content-length': String(bytes.byteLength) },
			body: bytes
		};
	}
	const start = match[1] === '' ? 0 : Number(match[1]);
	const end =
		match[2] === '' ? bytes.byteLength - 1 : Math.min(Number(match[2]), bytes.byteLength - 1);
	if (start >= bytes.byteLength) {
		return {
			status: 416,
			headers: { ...headers, 'content-range': `bytes */${bytes.byteLength}` },
			body: new Uint8Array()
		};
	}
	const body = bytes.slice(start, end + 1);
	return {
		status: 206,
		headers: {
			...headers,
			'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
			'content-length': String(body.byteLength)
		},
		body
	};
}
