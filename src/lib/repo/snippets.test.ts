import { describe, expect, it } from 'vitest';
import { useSnippets } from './snippets.ts';

const origin = 'https://hub.example';

describe('useSnippets', () => {
	it('offers transformers, hub and git snippets pointing at the current origin', () => {
		const snippets = useSnippets(
			'model',
			{ id: 'u/r', library_name: 'transformers', pipeline_tag: 'text-generation' },
			origin
		);
		expect(snippets.map((s) => s.title)).toEqual([
			'Transformers',
			'huggingface_hub',
			'hf CLI',
			'git'
		]);
		expect(snippets[0].code).toContain('pipeline("text-generation", model="u/r")');
		expect(snippets[0].code).toContain('os.environ["HF_ENDPOINT"] = "https://hub.example"');
		expect(snippets[1].code).toContain('snapshot_download("u/r")');
		expect(snippets[2].code).toBe('HF_ENDPOINT=https://hub.example hf download u/r');
		expect(snippets[3].code).toBe('git clone https://hub.example/u/r');
		expect(snippets.every((s) => !s.code.includes('huggingface.co'))).toBe(true);
	});

	it('picks the library snippet from library_name and skips unknown libraries', () => {
		expect(useSnippets('model', { id: 'u/r', library_name: 'diffusers' }, origin)[0]).toMatchObject(
			{
				title: 'Diffusers',
				language: 'python'
			}
		);
		expect(
			useSnippets('model', { id: 'u/r', library_name: 'sentence-transformers' }, origin)[0].code
		).toContain('SentenceTransformer("u/r")');
		expect(useSnippets('model', { id: 'u/r', library_name: 'mlx' }, origin)[0].title).toBe(
			'huggingface_hub'
		);
		expect(
			useSnippets('model', { id: 'u/r', library_name: 'transformers' }, origin)[0].code
		).toContain('AutoModel.from_pretrained("u/r")');
	});

	it('uses dataset and space repo types in every snippet', () => {
		const dataset = useSnippets('dataset', { id: 'u/d' }, origin);
		expect(dataset[0]).toMatchObject({ title: 'Datasets', language: 'python' });
		expect(dataset[0].code).toContain('load_dataset("u/d")');
		expect(dataset.find((s) => s.title === 'huggingface_hub')?.code).toContain(
			'snapshot_download("u/d", repo_type="dataset")'
		);
		expect(dataset.find((s) => s.title === 'hf CLI')?.code).toContain(
			'hf download u/d --repo-type dataset'
		);
		expect(dataset.find((s) => s.title === 'git')?.code).toBe(
			'git clone https://hub.example/datasets/u/d'
		);
		expect(useSnippets('space', { id: 'u/s' }, origin).map((s) => s.title)).toEqual([
			'huggingface_hub',
			'hf CLI',
			'git'
		]);
	});
});
