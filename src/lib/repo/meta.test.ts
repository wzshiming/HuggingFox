import { describe, expect, it } from 'vitest';
import {
	baseModels,
	datasetStats,
	initials,
	safetensorsSummary,
	spaceAppUrl,
	stringList,
	tagChips
} from './meta.ts';

describe('tagChips', () => {
	it('links model tags to the listing facet they belong to', () => {
		const chips = tagChips('model', {
			id: 'u/r',
			pipeline_tag: 'text-generation',
			library_name: 'transformers',
			tags: [
				'transformers',
				'text-generation',
				'en',
				'license:mit',
				'dataset:squad',
				'arxiv:1234.5678',
				'base_model:finetune:openai/gpt2',
				'region:us'
			]
		});
		expect(chips).toEqual([
			{ tag: 'transformers', label: 'transformers', href: '/models?library=transformers' },
			{
				tag: 'text-generation',
				label: 'text-generation',
				href: '/models?pipeline_tag=text-generation'
			},
			{ tag: 'en', label: 'en', href: '/models?other=en' },
			{ tag: 'license:mit', label: 'License: mit', href: '/models?license=license%3Amit' },
			{ tag: 'dataset:squad', label: 'Dataset: squad', href: '/models?dataset=dataset%3Asquad' },
			{
				tag: 'arxiv:1234.5678',
				label: 'arxiv: 1234.5678',
				href: '/models?other=arxiv%3A1234.5678'
			},
			{ tag: 'region:us', label: 'Region: us', href: '/models?other=region%3Aus' }
		]);
	});

	it('uses the dataset facets and the space sdk', () => {
		expect(
			tagChips('dataset', {
				id: 'u/d',
				tags: ['task_categories:qa', 'size_categories:1K<n<10K', 'x']
			})
		).toEqual([
			{
				tag: 'task_categories:qa',
				label: 'Task categories: qa',
				href: '/datasets?task_categories=task_categories%3Aqa'
			},
			{
				tag: 'size_categories:1K<n<10K',
				label: 'Size categories: 1K<n<10K',
				href: '/datasets?size_categories=size_categories%3A1K%3Cn%3C10K'
			},
			{ tag: 'x', label: 'x', href: '/datasets?other=x' }
		]);
		expect(tagChips('space', { id: 'u/s', sdk: 'gradio', tags: ['gradio', 'region:us'] })).toEqual([
			{ tag: 'gradio', label: 'gradio', href: '/spaces?sdk=gradio' },
			{ tag: 'region:us', label: 'Region: us', href: '/spaces?other=region%3Aus' }
		]);
		expect(tagChips('model', { id: 'u/r' })).toEqual([]);
	});
});

describe('safetensorsSummary', () => {
	it('reports parameters and dtypes from the hub metadata', () => {
		expect(
			safetensorsSummary({
				id: 'u/r',
				safetensors: { total: 137022720, parameters: { F32: 137022720 } }
			})
		).toEqual({ total: 137022720, dtypes: ['F32'] });
	});

	it('distinguishes missing metadata from repos without safetensors', () => {
		expect(
			safetensorsSummary({ id: 'u/r', siblings: [{ rfilename: 'model.safetensors' }] })
		).toEqual({ total: null, dtypes: [] });
		expect(safetensorsSummary({ id: 'u/r', siblings: [{ rfilename: 'model.bin' }] })).toBe(null);
		expect(safetensorsSummary({ id: 'u/r' })).toBe(null);
	});
});

describe('card data helpers', () => {
	it('only accepts strings from base_model and other list fields', () => {
		expect(baseModels({ id: 'u/r', cardData: { base_model: 'openai/gpt2' } })).toEqual([
			'openai/gpt2'
		]);
		expect(
			baseModels({ id: 'u/r', cardData: { base_model: ['a/b', { name: 'x' }, 3, 'c/d'] } })
		).toEqual(['a/b', 'c/d']);
		expect(baseModels({ id: 'u/r', cardData: { base_model: { name: 'x' } } })).toEqual([]);
		expect(baseModels({ id: 'u/r' })).toEqual([]);
		expect(stringList(undefined)).toEqual([]);
	});

	it('sums dataset rows and download sizes across configs and splits', () => {
		const dataset_info = [
			{
				config_name: 'main',
				splits: [{ num_examples: 7473 }, { num_examples: 1319 }],
				download_size: 2725633
			},
			{ config_name: 'socratic', splits: [{ num_examples: 7473 }], download_size: 3164254 }
		];
		expect(datasetStats({ id: 'u/d', cardData: { dataset_info } })).toEqual({
			rows: 16265,
			downloadSize: 5889887
		});
		expect(
			datasetStats({ id: 'u/d', cardData: { dataset_info: { splits: [{ num_examples: 5 }] } } })
		).toEqual({ rows: 5, downloadSize: null });
		expect(datasetStats({ id: 'u/d' })).toEqual({ rows: null, downloadSize: null });
	});

	it('builds initials for the avatar fallback', () => {
		expect(initials('Julien Chaumond')).toBe('JC');
		expect(initials('openai-community')).toBe('OC');
		expect(initials('alice')).toBe('A');
		expect(initials('')).toBe('?');
	});
});

describe('spaceAppUrl', () => {
	it('embeds only running spaces served from an hf.space host', () => {
		const running = { stage: 'RUNNING' };
		expect(spaceAppUrl({ id: 'u/s', host: 'https://u-s.hf.space', runtime: running })).toBe(
			'https://u-s.hf.space'
		);
		expect(spaceAppUrl({ id: 'u/s', host: 'https://u-s.static.hf.space', runtime: running })).toBe(
			'https://u-s.static.hf.space'
		);
		for (const host of [
			'http://u-s.hf.space',
			'https://u-s.hf.space.evil.example',
			'https://evil.example/?x=.hf.space',
			'https://hf.space',
			'https://u-s.hf.space/path',
			'javascript:alert(1)'
		]) {
			expect(spaceAppUrl({ id: 'u/s', host, runtime: running })).toBe(null);
		}
		expect(
			spaceAppUrl({ id: 'u/s', host: 'https://u-s.hf.space', runtime: { stage: 'SLEEPING' } })
		).toBe(null);
		expect(spaceAppUrl({ id: 'u/s', host: 'https://u-s.hf.space' })).toBe(null);
		expect(spaceAppUrl({ id: 'u/s', runtime: running })).toBe(null);
	});
});
