import type { ListReposParams } from '$lib/api/client';
import type { RepoType } from '$lib/api/url';

export type SortKey = 'trending' | 'likes' | 'downloads' | 'created' | 'modified';

export const sortKeys: readonly SortKey[] = [
	'trending',
	'likes',
	'downloads',
	'created',
	'modified'
];

const apiSort: Record<SortKey, string> = {
	trending: 'trendingScore',
	likes: 'likes',
	downloads: 'downloads',
	created: 'createdAt',
	modified: 'lastModified'
};

export interface Facet {
	// Page url parameter (HF naming) and tags-by-type category key.
	param: string;
	// Prefix the hub expects on api filter tags when the url value carries none.
	prefix: string;
	// Dedicated api query parameter; `filter` would also match repos merely tagged with the value.
	query?: 'pipeline_tag';
}

const facets: Record<RepoType, Facet[]> = {
	model: [
		{ param: 'pipeline_tag', prefix: '', query: 'pipeline_tag' },
		{ param: 'library', prefix: '' },
		{ param: 'dataset', prefix: 'dataset:' },
		{ param: 'language', prefix: '' },
		{ param: 'license', prefix: 'license:' },
		{ param: 'other', prefix: '' }
	],
	dataset: [
		{ param: 'task_categories', prefix: 'task_categories:' },
		{ param: 'size_categories', prefix: 'size_categories:' },
		{ param: 'modality', prefix: 'modality:' },
		{ param: 'format', prefix: 'format:' },
		{ param: 'library', prefix: 'library:' },
		{ param: 'language', prefix: 'language:' },
		{ param: 'license', prefix: 'license:' },
		{ param: 'other', prefix: '' }
	],
	space: [
		{ param: 'sdk', prefix: '' },
		{ param: 'other', prefix: '' }
	]
};

export function facetsFor(type: RepoType): readonly Facet[] {
	return facets[type];
}

export interface ListingState {
	facets: Record<string, string[]>;
	search: string;
	author: string;
	sort: SortKey;
	cursor: string;
}

// Facet values are kept as full hub tag ids, so bare values gain the facet prefix here.
export function parseListing(type: RepoType, params: URLSearchParams): ListingState {
	const state: ListingState = { facets: {}, search: '', author: '', sort: 'trending', cursor: '' };
	for (const { param, prefix } of facets[type]) {
		const values = params
			.getAll(param)
			.filter((v) => v.trim())
			.map((v) => (v.includes(':') ? v : prefix + v));
		if (values.length) state.facets[param] = values;
	}
	state.search = (params.get('search') ?? '').trim();
	state.author = (params.get('author') ?? '').trim();
	const sort = params.get('sort') as SortKey | null;
	if (sort && sortKeys.includes(sort)) state.sort = sort;
	state.cursor = params.get('cursor') ?? '';
	return state;
}

export function listingParams(type: RepoType, state: ListingState, limit: number): ListReposParams {
	const filter = facets[type]
		.filter(({ query }) => !query)
		.flatMap(({ param }) => state.facets[param] ?? []);
	const params: ListReposParams = {
		filter: filter.length ? filter : undefined,
		search: state.search || undefined,
		author: state.author || undefined,
		sort: apiSort[state.sort],
		direction: -1,
		limit,
		cursor: state.cursor || undefined
	};
	for (const { param, query } of facets[type]) {
		if (query && state.facets[param]?.length) params[query] = state.facets[param];
	}
	return params;
}

export function listingSearch(state: ListingState): URLSearchParams {
	const params = new URLSearchParams();
	for (const [param, values] of Object.entries(state.facets)) {
		for (const v of values) params.append(param, v);
	}
	if (state.search) params.set('search', state.search);
	if (state.author) params.set('author', state.author);
	if (state.sort !== 'trending') params.set('sort', state.sort);
	if (state.cursor) params.set('cursor', state.cursor);
	return params;
}

// Any change of query, filters, sort or author starts again from the first page.
export function withListing(
	state: ListingState,
	patch: Partial<Omit<ListingState, 'facets'>>
): ListingState {
	return { ...state, cursor: '', ...patch };
}

export function toggleFacet(state: ListingState, param: string, value: string): ListingState {
	const current = state.facets[param] ?? [];
	const values = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
	const next = { ...state.facets };
	if (values.length) next[param] = values;
	else delete next[param];
	return { ...state, facets: next, cursor: '' };
}

export function cursorOf(next: string | null): string | null {
	if (!next) return null;
	return new URLSearchParams(next.split('?')[1] ?? '').get('cursor');
}
