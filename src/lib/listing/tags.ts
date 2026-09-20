import type { RepoSummary } from '$lib/api/types';
import type { RepoType } from '$lib/api/url';
import { facetsFor } from './query.ts';

export interface FacetTag {
	// Hub tag id as it appears in the api filter; label is what the sidebar shows.
	id: string;
	label: string;
}

export interface FacetGroup {
	param: string;
	tags: FacetTag[];
}

// Accepts the hub's tags-by-type map, including sparse variants without every field.
export function facetGroups(
	type: RepoType,
	byType: Record<string, readonly (FacetTag & Record<string, unknown>)[] | undefined>
): FacetGroup[] {
	return facetsFor(type)
		.map(({ param }) => ({
			param,
			tags: (byType[param] ?? []).map(({ id, label }) => ({ id, label }))
		}))
		.filter((group) => group.tags.length);
}

// Sparse hubs without tags-by-type: build the sidebar from what the listed repos carry.
export function observedFacets(type: RepoType, repos: RepoSummary[]): FacetGroup[] {
	const seen = new Map<string, Map<string, string>>();
	const add = (param: string, id: string, label: string) => {
		let tags = seen.get(param);
		if (!tags) seen.set(param, (tags = new Map()));
		if (!tags.has(id)) tags.set(id, label);
	};
	const facets = facetsFor(type).filter((f) => f.prefix);
	for (const repo of repos) {
		if (type === 'model') {
			if (repo.pipeline_tag) add('pipeline_tag', repo.pipeline_tag, repo.pipeline_tag);
			if (repo.library_name) add('library', repo.library_name, repo.library_name);
		}
		if (type === 'space' && repo.sdk) add('sdk', repo.sdk, repo.sdk);
		for (const tag of repo.tags ?? []) {
			const facet = facets.find((f) => tag.startsWith(f.prefix));
			if (facet) add(facet.param, tag, tag.slice(facet.prefix.length));
		}
	}
	return facetsFor(type)
		.filter(({ param }) => seen.has(param))
		.map(({ param }) => ({
			param,
			tags: [...seen.get(param)!].map(([id, label]) => ({ id, label }))
		}));
}
