import type { RepoInfo, RepoSummary } from '$lib/api/types';
import { listPagePath, type RepoType } from '$lib/api/url';
import { facetsFor } from '$lib/listing/query';

export interface TagChip {
	tag: string;
	label: string;
	href: string;
}

const hidden = /^base_model:/;

function chipLabel(tag: string): string {
	const at = tag.indexOf(':');
	if (at < 0) return tag;
	const prefix = tag.slice(0, at).replace(/_/g, ' ');
	const head = /^[a-z]/.test(prefix) && prefix !== 'arxiv' && prefix !== 'doi';
	return `${head ? prefix[0].toUpperCase() + prefix.slice(1) : prefix}: ${tag.slice(at + 1)}`;
}

// Every chip is a working listing filter; unknown tags fall back to the "other" facet.
export function tagChips(type: RepoType, repo: RepoSummary): TagChip[] {
	const facets = facetsFor(type).filter((f) => f.prefix);
	return (repo.tags ?? [])
		.filter((tag) => !hidden.test(tag))
		.map((tag) => {
			const param =
				type === 'model' && tag === repo.pipeline_tag
					? 'pipeline_tag'
					: type === 'model' && tag === repo.library_name
						? 'library'
						: type === 'space' && tag === repo.sdk
							? 'sdk'
							: (facets.find((f) => tag.startsWith(f.prefix))?.param ?? 'other');
			const search = new URLSearchParams({ [param]: tag });
			return { tag, label: chipLabel(tag), href: `${listPagePath(type)}?${search}` };
		});
}

export function stringList(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
	return [];
}

export function baseModels(info: RepoInfo): string[] {
	return stringList(info.cardData?.base_model);
}

export interface SafetensorsSummary {
	// null total means the repo ships safetensors but the hub gave no parameter metadata.
	total: number | null;
	dtypes: string[];
}

export function safetensorsSummary(info: RepoInfo): SafetensorsSummary | null {
	if (typeof info.safetensors?.total === 'number') {
		return {
			total: info.safetensors.total,
			dtypes: Object.keys(info.safetensors.parameters ?? {})
		};
	}
	if (info.siblings?.some((s) => s.rfilename.endsWith('.safetensors'))) {
		return { total: null, dtypes: [] };
	}
	return null;
}

export function datasetStats(info: RepoInfo): { rows: number | null; downloadSize: number | null } {
	const raw = info.cardData?.dataset_info;
	const configs = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
	let rows: number | null = null;
	let downloadSize: number | null = null;
	for (const config of configs) {
		if (typeof config !== 'object' || !config) continue;
		for (const split of Array.isArray(config.splits) ? config.splits : []) {
			if (typeof split?.num_examples === 'number') rows = (rows ?? 0) + split.num_examples;
		}
		if (typeof config.download_size === 'number') {
			downloadSize = (downloadSize ?? 0) + config.download_size;
		}
	}
	return { rows, downloadSize };
}

export function initials(name: string): string {
	const parts = name.split(/[\s_-]+/).filter(Boolean);
	const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0]?.[0] ?? '?');
	return letters.toUpperCase();
}

const spaceHost = /^https:\/\/(?:[a-z0-9-]+\.)+hf\.space$/;

export function spaceAppUrl(info: RepoInfo): string | null {
	if (info.runtime?.stage !== 'RUNNING' || !info.host) return null;
	return spaceHost.test(info.host) ? info.host : null;
}
