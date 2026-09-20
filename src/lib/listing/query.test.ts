import { describe, expect, it } from 'vitest';
import {
	cursorOf,
	facetsFor,
	listingParams,
	listingSearch,
	parseListing,
	toggleFacet,
	withListing
} from './query.ts';

const sp = (s: string) => new URLSearchParams(s);

describe('parseListing', () => {
	it('reads HF-style facet, search, author, sort and cursor params', () => {
		const state = parseListing(
			'model',
			sp(
				'pipeline_tag=text-generation&library=pytorch&library=jax&license=license:mit&other=endpoints_compatible&search=bert&author=google&sort=likes&cursor=eyJ%3D'
			)
		);
		expect(state).toEqual({
			facets: {
				pipeline_tag: ['text-generation'],
				library: ['pytorch', 'jax'],
				license: ['license:mit'],
				other: ['endpoints_compatible']
			},
			search: 'bert',
			author: 'google',
			sort: 'likes',
			cursor: 'eyJ='
		});
	});

	it('ignores unknown facets, unknown sorts and blank values', () => {
		const state = parseListing('dataset', sp('pipeline_tag=x&sort=bogus&language=&search=+'));
		expect(state.facets).toEqual({});
		expect(state.sort).toBe('trending');
		expect(state.search).toBe('');
	});

	it('normalizes bare facet values to the hub tag id', () => {
		expect(parseListing('dataset', sp('language=en&license=license:mit')).facets).toEqual({
			language: ['language:en'],
			license: ['license:mit']
		});
		expect(parseListing('model', sp('license=mit&language=en')).facets).toEqual({
			language: ['en'],
			license: ['license:mit']
		});
	});
});

describe('listingParams', () => {
	it('maps model facets to bare or prefixed api filter tags and tasks to pipeline_tag', () => {
		const state = parseListing(
			'model',
			sp(
				'pipeline_tag=text-generation&library=pytorch&language=en&license=mit&dataset=squad&other=arxiv:1234&other=license:apache-2.0'
			)
		);
		expect(listingParams('model', state, 30)).toEqual({
			filter: ['pytorch', 'dataset:squad', 'en', 'license:mit', 'arxiv:1234', 'license:apache-2.0'],
			pipeline_tag: ['text-generation'],
			sort: 'trendingScore',
			direction: -1,
			limit: 30
		});
	});

	it('prefixes dataset facets and leaves already-prefixed ids alone', () => {
		const state = parseListing(
			'dataset',
			sp(
				'task_categories=text-classification&language=language:en&library=datasets&license=mit&size_categories=1K<n<10K&format=parquet&modality=text'
			)
		);
		expect(listingParams('dataset', state, 30).filter).toEqual([
			'task_categories:text-classification',
			'size_categories:1K<n<10K',
			'modality:text',
			'format:parquet',
			'library:datasets',
			'language:en',
			'license:mit'
		]);
	});

	it('maps sorts, search, author and the opaque cursor', () => {
		const state = parseListing(
			'space',
			sp('sdk=gradio&sort=modified&search=chat&author=alice&cursor=abc')
		);
		expect(listingParams('space', state, 12)).toEqual({
			filter: ['gradio'],
			search: 'chat',
			author: 'alice',
			sort: 'lastModified',
			direction: -1,
			limit: 12,
			cursor: 'abc'
		});
		expect(listingParams('model', parseListing('model', sp('sort=created')), 1).sort).toBe(
			'createdAt'
		);
		expect(listingParams('model', parseListing('model', sp('sort=downloads')), 1).sort).toBe(
			'downloads'
		);
	});
});

describe('url state', () => {
	const base = parseListing('model', sp('pipeline_tag=fill-mask&sort=likes&cursor=abc&search=x'));

	it('serializes only non-default values', () => {
		expect(listingSearch(base).toString()).toBe(
			'pipeline_tag=fill-mask&search=x&sort=likes&cursor=abc'
		);
		expect(listingSearch(parseListing('model', sp(''))).toString()).toBe('');
	});

	it('toggles a facet value and drops the cursor', () => {
		const on = toggleFacet(base, 'library', 'pytorch');
		expect(on.facets).toEqual({ pipeline_tag: ['fill-mask'], library: ['pytorch'] });
		expect(on.cursor).toBe('');
		const off = toggleFacet(on, 'pipeline_tag', 'fill-mask');
		expect(off.facets).toEqual({ library: ['pytorch'] });
	});

	it('drops the cursor whenever search, sort or author change', () => {
		expect(withListing(base, { search: 'bert' }).cursor).toBe('');
		expect(withListing(base, { sort: 'trending' }).cursor).toBe('');
		expect(withListing(base, { author: 'a' }).cursor).toBe('');
		expect(withListing(base, { cursor: 'next' }).cursor).toBe('next');
	});
});

describe('cursorOf', () => {
	it('extracts the opaque cursor from a same-endpoint next page path', () => {
		expect(cursorOf('/api/models?limit=30&cursor=eyJfaWQiOiI2N2EifQ%3D%3D')).toBe(
			'eyJfaWQiOiI2N2EifQ=='
		);
		expect(cursorOf('/api/models?limit=30')).toBe(null);
		expect(cursorOf(null)).toBe(null);
	});
});

describe('facetsFor', () => {
	it('lists sidebar facets in HF order per repo type', () => {
		expect(facetsFor('model').map((f) => f.param)).toEqual([
			'pipeline_tag',
			'library',
			'dataset',
			'language',
			'license',
			'other'
		]);
		expect(facetsFor('dataset').map((f) => f.param)).toEqual([
			'task_categories',
			'size_categories',
			'modality',
			'format',
			'library',
			'language',
			'license',
			'other'
		]);
		expect(facetsFor('space').map((f) => f.param)).toEqual(['sdk', 'other']);
	});
});
