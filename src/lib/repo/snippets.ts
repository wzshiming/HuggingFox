import type { RepoSummary } from '$lib/api/types';
import { repoPagePath, type RepoType } from '$lib/api/url';

export interface Snippet {
	title: string;
	language: 'python' | 'bash';
	code: string;
}

const endpoint = (origin: string) => `import os\nos.environ["HF_ENDPOINT"] = "${origin}"\n`;

function librarySnippet(repo: RepoSummary, origin: string): Snippet | null {
	const head = endpoint(origin);
	switch (repo.library_name) {
		case 'transformers':
			return {
				title: 'Transformers',
				language: 'python',
				code: repo.pipeline_tag
					? `${head}from transformers import pipeline\n\npipe = pipeline("${repo.pipeline_tag}", model="${repo.id}")`
					: `${head}from transformers import AutoModel\n\nmodel = AutoModel.from_pretrained("${repo.id}")`
			};
		case 'diffusers':
			return {
				title: 'Diffusers',
				language: 'python',
				code: `${head}from diffusers import DiffusionPipeline\n\npipe = DiffusionPipeline.from_pretrained("${repo.id}")`
			};
		case 'sentence-transformers':
			return {
				title: 'Sentence Transformers',
				language: 'python',
				code: `${head}from sentence_transformers import SentenceTransformer\n\nmodel = SentenceTransformer("${repo.id}")`
			};
		default:
			return null;
	}
}

// Snippets only ever reference this deployment, never a hard-coded public hub.
export function useSnippets(type: RepoType, repo: RepoSummary, origin: string): Snippet[] {
	const head = endpoint(origin);
	const repoType = type === 'model' ? '' : ` --repo-type ${type}`;
	const kwarg = type === 'model' ? '' : `, repo_type="${type}"`;
	const first =
		type === 'dataset'
			? {
					title: 'Datasets',
					language: 'python' as const,
					code: `${head}from datasets import load_dataset\n\nds = load_dataset("${repo.id}")`
				}
			: type === 'model'
				? librarySnippet(repo, origin)
				: null;
	return [
		...(first ? [first] : []),
		{
			title: 'huggingface_hub',
			language: 'python',
			code: `${head}from huggingface_hub import snapshot_download\n\nsnapshot_download("${repo.id}"${kwarg})`
		},
		{
			title: 'hf CLI',
			language: 'bash',
			code: `HF_ENDPOINT=${origin} hf download ${repo.id}${repoType}`
		},
		{ title: 'git', language: 'bash', code: `git clone ${origin}${repoPagePath(type, repo.id)}` }
	];
}
