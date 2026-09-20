import { gguf, GGMLQuantizationType, type MetadataValue } from '@huggingface/gguf';

export interface GgufSummary {
	version: number;
	architecture: string | null;
	name: string | null;
	kv: { key: string; value: string }[];
	tensors: { name: string; shape: string; dtype: string }[];
	tensorCount: number;
	parameterCount: number;
	truncated: boolean;
}

export const MAX_GGUF_ROWS = 1000;
const ARRAY_PREVIEW = 8;

export function displayValue(value: MetadataValue): string {
	if (Array.isArray(value)) {
		const head = value.slice(0, ARRAY_PREVIEW).map(displayValue);
		if (value.length > ARRAY_PREVIEW) head.push('…');
		return `[${value.length}] ${head.join(', ')}`;
	}
	return String(value);
}

const own = new Set(['version', 'tensor_count', 'kv_count']);

// Header-only parse through the library's ranged reads; `fetch` must be a bounded, bearer-aware fetcher.
export async function loadGguf(
	url: string,
	{ fetch: fetchImpl }: { fetch: typeof globalThis.fetch }
): Promise<GgufSummary> {
	const { metadata, tensorInfos, parameterCount } = await gguf(url, {
		fetch: fetchImpl,
		computeParametersCount: true
	});
	const entries = metadata as Record<string, MetadataValue>;
	const text = (key: string) => {
		const value = entries[key];
		return typeof value === 'string' ? value : null;
	};
	return {
		version: metadata.version,
		architecture: text('general.architecture'),
		name: text('general.name'),
		kv: Object.entries(entries)
			.filter(([key]) => !own.has(key))
			.map(([key, value]) => ({ key, value: displayValue(value) })),
		tensors: tensorInfos.slice(0, MAX_GGUF_ROWS).map((t) => ({
			name: t.name,
			shape: t.shape.map(String).join(' × '),
			dtype: GGMLQuantizationType[t.dtype] ?? String(t.dtype)
		})),
		tensorCount: tensorInfos.length,
		parameterCount,
		truncated: tensorInfos.length > MAX_GGUF_ROWS
	};
}
