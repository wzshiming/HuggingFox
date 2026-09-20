import {
	parseSafetensorsMetadata,
	type SafetensorsFileHeader,
	type SafetensorsParseFromRepo
} from '@huggingface/hub';
import { encodeSegments, repoPagePath, type RepoType } from '$lib/api/url';

export interface TensorRow {
	name: string;
	dtype: string;
	shape: number[];
	bytes: number;
}

export interface SafetensorsSummary {
	metadata: [string, string][];
	tensors: TensorRow[];
	tensorCount: number;
	truncated: boolean;
	parameterCount: Partial<Record<string, number>>;
	parameterTotal: number;
}

export const MAX_TENSOR_ROWS = 1000;

export function tensorRows(header: SafetensorsFileHeader): {
	metadata: [string, string][];
	tensors: TensorRow[];
} {
	const { __metadata__: meta, ...rest } = header;
	return {
		metadata: Object.entries(meta ?? {}).map(([k, v]) => [k, String(v)]),
		tensors: Object.entries(rest).map(([name, info]) => ({
			name,
			dtype: info.dtype,
			shape: info.shape,
			bytes: info.data_offsets[1] - info.data_offsets[0]
		}))
	};
}

export interface FileTarget {
	type: RepoType;
	id: string;
	rev: string;
	path: string;
}

// Header-only read via the library's ranged downloads; `fetch` must be a bounded, bearer-aware fetcher.
export async function loadSafetensors(
	{ type, id, rev, path }: FileTarget,
	{ origin, fetch: fetchImpl }: { origin: string; fetch: typeof globalThis.fetch }
): Promise<SafetensorsSummary> {
	const params: Parameters<typeof parseSafetensorsMetadata>[0] & { xet: false } = {
		// The library only builds `${hubUrl}/${name}/resolve/…`; the page prefix carries the repo type.
		repo: { type: 'model', name: repoPagePath(type, id).slice(1) },
		// Concatenated verbatim by the library, so segments are escaped here.
		path: encodeSegments(path),
		revision: rev,
		hubUrl: origin,
		fetch: fetchImpl,
		computeParametersCount: true,
		xet: false
	};
	const result: SafetensorsParseFromRepo = await parseSafetensorsMetadata(params);
	if (result.sharded) throw new Error('not a single safetensors file');
	const { metadata, tensors } = tensorRows(result.header);
	const parameterCount = result.parameterCount ?? {};
	return {
		metadata,
		tensors: tensors.slice(0, MAX_TENSOR_ROWS),
		tensorCount: tensors.length,
		truncated: tensors.length > MAX_TENSOR_ROWS,
		parameterCount,
		parameterTotal:
			result.parameterTotal ?? Object.values(parameterCount).reduce((n, v) => n + (v ?? 0), 0)
	};
}
