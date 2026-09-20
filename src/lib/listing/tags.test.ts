import { describe, expect, it } from 'vitest';
import { facetGroups, observedFacets } from './tags.ts';

describe('facetGroups', () => {
	it('keeps the sidebar facets that the hub reports tags for, in facet order', () => {
		const groups = facetGroups('model', {
			license: [{ id: 'license:mit', label: 'mit', type: 'license' }],
			pipeline_tag: [
				{ id: 'text-generation', label: 'Text Generation', type: 'pipeline_tag', subType: 'nlp' },
				{ id: 'fill-mask', label: 'Fill-Mask', type: 'pipeline_tag' }
			],
			region: [{ id: 'region:us', label: 'Region: US', type: 'region' }],
			other: []
		});
		expect(groups.map((g) => g.param)).toEqual(['pipeline_tag', 'license']);
		expect(groups[0].tags.map((t) => t.id)).toEqual(['text-generation', 'fill-mask']);
		expect(groups[1].tags).toEqual([{ id: 'license:mit', label: 'mit' }]);
	});

	it('strips the facet prefix from dataset tag ids only where it matches', () => {
		const [languages] = facetGroups('dataset', {
			language: [{ id: 'language:en', label: 'English', type: 'language' }]
		});
		expect(languages.tags).toEqual([{ id: 'language:en', label: 'English' }]);
	});
});

describe('observedFacets', () => {
	it('derives model facets from the fields and prefixed tags of listed repos', () => {
		const groups = observedFacets('model', [
			{
				id: 'a/b',
				pipeline_tag: 'text-generation',
				library_name: 'transformers',
				tags: ['transformers', 'en', 'license:mit', 'text-generation']
			},
			{ id: 'c/d', pipeline_tag: 'fill-mask', tags: ['license:apache-2.0', 'license:mit'] },
			{ id: 'e/f', tags: undefined }
		]);
		expect(groups).toEqual([
			{
				param: 'pipeline_tag',
				tags: [
					{ id: 'text-generation', label: 'text-generation' },
					{ id: 'fill-mask', label: 'fill-mask' }
				]
			},
			{ param: 'library', tags: [{ id: 'transformers', label: 'transformers' }] },
			{
				param: 'license',
				tags: [
					{ id: 'license:mit', label: 'mit' },
					{ id: 'license:apache-2.0', label: 'apache-2.0' }
				]
			}
		]);
	});

	it('groups dataset and space tags by their prefixes and sdk', () => {
		expect(
			observedFacets('dataset', [
				{ id: 'x/y', tags: ['task_categories:qa', 'language:en', 'library:datasets', 'misc'] }
			])
		).toEqual([
			{ param: 'task_categories', tags: [{ id: 'task_categories:qa', label: 'qa' }] },
			{ param: 'library', tags: [{ id: 'library:datasets', label: 'datasets' }] },
			{ param: 'language', tags: [{ id: 'language:en', label: 'en' }] }
		]);
		expect(observedFacets('space', [{ id: 'x/y', sdk: 'gradio', tags: ['gradio'] }])).toEqual([
			{ param: 'sdk', tags: [{ id: 'gradio', label: 'gradio' }] }
		]);
	});
});
