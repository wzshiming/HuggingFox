import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Fixtures follow the shapes recorded from huggingface.co and hfd (see S3 report), trimmed.
const listed = (id: string, extra: Record<string, unknown> = {}) => ({
	_id: id,
	id,
	likes: 12,
	private: false,
	downloads: 3400,
	tags: ['transformers', 'text-generation', 'license:mit'],
	pipeline_tag: 'text-generation',
	library_name: 'transformers',
	createdAt: '2026-09-08T13:56:18.000Z',
	...extra
});

const modelTags = {
	pipeline_tag: [
		{ id: 'text-generation', label: 'Text Generation', type: 'pipeline_tag', subType: 'nlp' },
		{ id: 'fill-mask', label: 'Fill-Mask', type: 'pipeline_tag', subType: 'nlp' }
	],
	library: [{ id: 'pytorch', label: 'PyTorch', type: 'library' }],
	language: [{ id: 'en', label: 'English', type: 'language' }],
	license: [{ id: 'license:mit', label: 'mit', type: 'license' }],
	region: [{ id: 'region:us', label: 'Region: US', type: 'region' }]
};
const datasetTags = {
	task_categories: [
		{
			id: 'task_categories:text-classification',
			label: 'Text Classification',
			type: 'task_categories'
		}
	],
	language: [{ id: 'language:en', label: 'English', type: 'language' }],
	library: [{ id: 'library:datasets', label: 'Datasets', type: 'library' }]
};

const gpt2 = {
	_id: '621ffdc036468d709f17434d',
	id: 'openai-community/gpt2',
	private: false,
	pipeline_tag: 'text-generation',
	library_name: 'transformers',
	tags: ['transformers', 'pytorch', 'text-generation', 'en', 'license:mit', 'region:us'],
	downloads: 15439333,
	likes: 4141,
	author: 'openai-community',
	sha: '607a30d783dfa663caf39e06633721c8d4cfcd7e',
	lastModified: '2024-02-19T10:57:45.000Z',
	gated: false,
	disabled: false,
	cardData: { language: 'en', license: 'mit', base_model: 'openai-community/gpt2-base' },
	siblings: [
		{ rfilename: 'README.md' },
		{ rfilename: 'config.json' },
		{ rfilename: 'model.safetensors' }
	],
	spaces: ['alice/demo', 'bob/playground'],
	createdAt: '2022-03-02T23:29:04.000Z',
	safetensors: { parameters: { F32: 137022720 }, total: 137022720 },
	usedStorage: 11977009063
};

const gsm8k = {
	_id: '625552d2b339bb03abe3432d',
	id: 'openai/gsm8k',
	author: 'openai',
	sha: '740312add88f781978c0658806c59bc2815b9866',
	lastModified: '2026-03-23T10:18:13.000Z',
	private: false,
	gated: false,
	tags: [
		'task_categories:text-generation',
		'language:en',
		'license:mit',
		'size_categories:10K<n<100K'
	],
	downloads: 1244383,
	likes: 1648,
	cardData: {
		dataset_info: [
			{
				config_name: 'main',
				splits: [{ num_examples: 7473 }, { num_examples: 1319 }],
				download_size: 2725633
			},
			{ config_name: 'socratic', splits: [{ num_examples: 7473 }], download_size: 3164254 }
		]
	},
	siblings: [{ rfilename: 'README.md' }, { rfilename: 'main/train-00000-of-00001.parquet' }],
	createdAt: '2022-04-12T10:22:10.000Z',
	usedStorage: 11758552
};

const space = (host: string | undefined, stage: string) => ({
	_id: '6aa7b287e610f9872a6aa5fc',
	id: 'lynote/ai-notes',
	sdk: 'static',
	likes: 124,
	tags: ['static', 'region:us'],
	private: false,
	author: 'lynote',
	cardData: {
		title: 'AI Notes',
		emoji: '\u{1F4DD}',
		colorFrom: 'indigo',
		colorTo: 'green',
		sdk: 'static'
	},
	subdomain: 'lynote-ai-notes',
	host,
	models: ['openai-community/gpt2'],
	siblings: [{ rfilename: 'README.md' }, { rfilename: 'index.html' }],
	runtime: { stage, hardware: { current: null, requested: null } }
});

const julien = {
	_id: '5dd96eb166059660ed1ee413',
	avatarUrl: 'https://cdn-avatars.example/julien.jpeg',
	isPro: true,
	fullname: 'Julien Chaumond',
	numModels: 53,
	numDatasets: 26,
	numSpaces: 47,
	numFollowers: 4884,
	orgs: [
		{
			id: '1',
			name: 'huggingface',
			fullname: 'Hugging Face',
			avatarUrl: 'https://cdn-avatars.example/hf.png'
		}
	],
	user: 'julien-c',
	type: 'user',
	createdAt: '2019-11-23T21:13:53.000Z'
};

const readme = `---
language: en
license: mit
---

# GPT-2

Test the whole generation capabilities [here](https://transformer.example/doc/gpt2-large).

## Usage

\`\`\`python
from transformers import pipeline
\`\`\`

| Split | Rows |
|-------|------|
| train | 7473 |

- [x] pretrained
- [ ] fine-tuned

Loss: $L = -\\sum_i \\log p_i$

![plot](assets/plot.png)

See the [docs](docs/usage.md) and the [usage section](#usage).

<script>window.pwned = true</script>
<img src="x" onerror="window.pwned = true">
<a href="javascript:window.pwned = true">bad link</a>
<a href="data:text/html,<script>window.pwned=true</script>">data link</a>
<iframe src="https://evil.example"></iframe>
`;

interface HubOptions {
	tags?: number;
	overview?: number;
	info?: number;
	readme?: number;
	model?: Record<string, unknown>;
	spaceHost?: string;
	spaceStage?: string;
	total?: number;
}

// Serves the hub API and README downloads from fixtures and records every request url.
async function mockHub(page: Page, options: HubOptions = {}) {
	const calls: URL[] = [];
	const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
		status,
		contentType: 'application/json',
		headers,
		body: JSON.stringify(body)
	});
	await page.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		calls.push(url);
		const path = url.pathname;
		const listHeaders: Record<string, string> = {};
		if (options.total !== undefined) listHeaders['x-total-count'] = String(options.total);
		// Authors without repositories, so the profile fallback and the legacy alias can be exercised.
		const empty = ['ghost', 'gpt2'].includes(url.searchParams.get('author') ?? '');
		if (path === '/api/models-tags-by-type' || path === '/api/datasets-tags-by-type') {
			if (options.tags && options.tags !== 200)
				return route.fulfill(json({ error: 'nope' }, options.tags));
			return route.fulfill(json(path.startsWith('/api/models') ? modelTags : datasetTags));
		}
		if (path === '/api/whoami-v2') {
			return route.fulfill(json({ type: 'user', name: 'alice', fullname: 'Alice' }));
		}
		if (path === '/api/models') {
			if (empty) return route.fulfill(json([], 200, listHeaders));
			if (url.searchParams.get('cursor') === 'c2') {
				return route.fulfill(json([listed('page-two/model')], 200, listHeaders));
			}
			return route.fulfill(
				json(
					[listed('openai-community/gpt2'), listed('google/bert', { pipeline_tag: 'fill-mask' })],
					200,
					{
						...listHeaders,
						link: `<${url.origin}/api/models?limit=30&sort=trendingScore&direction=-1&cursor=c2>; rel="next"`
					}
				)
			);
		}
		if (path === '/api/datasets') {
			return route.fulfill(
				json(empty ? [] : [listed('openai/gsm8k', { tags: gsm8k.tags })], 200, listHeaders)
			);
		}
		if (path === '/api/spaces') {
			return route.fulfill(
				json(
					empty ? [] : [listed('lynote/ai-notes', { sdk: 'static', tags: ['static'] })],
					200,
					listHeaders
				)
			);
		}
		if (path.endsWith('/refs')) {
			return route.fulfill(
				json({
					tags: [],
					branches: [{ name: 'main', ref: 'refs/heads/main', targetCommit: gpt2.sha }],
					converts: []
				})
			);
		}
		if (path === '/api/users/julien-c/overview') return route.fulfill(json(julien));
		if (path.startsWith('/api/users/'))
			return route.fulfill(json({ error: 'Not found' }, options.overview ?? 404));
		if (path === '/api/models/openai-community/gpt2') {
			if (options.info && options.info !== 200)
				return route.fulfill(json({ error: 'Repository not found' }, options.info));
			return route.fulfill(json(options.model ?? gpt2));
		}
		if (path === '/api/models/gpt2') return route.fulfill(json(gpt2));
		if (path === '/api/datasets/openai/gsm8k') return route.fulfill(json(gsm8k));
		if (path === '/api/spaces/lynote/ai-notes') {
			return route.fulfill(json(space(options.spaceHost, options.spaceStage ?? 'RUNNING')));
		}
		return route.fulfill(json({ error: 'not mocked' }, 404));
	});
	await page.route('**/resolve/**', async (route) => {
		const url = new URL(route.request().url());
		calls.push(url);
		if (options.readme && options.readme !== 200) {
			return route.fulfill(json({ error: 'Entry not found' }, options.readme));
		}
		return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: readme });
	});
	await page.route('https://cdn-avatars.example/**', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'
		})
	);
	return calls;
}

const requests = (calls: URL[], path: string) => calls.filter((u) => u.pathname === path);
const last = (calls: URL[], path: string) => requests(calls, path).at(-1)!;

test.describe('listings', () => {
	test('renders hub filters and maps facets, sort and search to the api', async ({ page }) => {
		const calls = await mockHub(page, { total: 2146391 });
		await page.goto('/models');
		await expect(page.getByRole('heading', { name: /^Models/, level: 1 })).toBeVisible();
		await expect(page.getByTestId('listing-count')).toHaveText('2,146,391');
		await expect(page.getByRole('link', { name: 'openai-community/gpt2' })).toBeVisible();
		expect(last(calls, '/api/models').searchParams.get('sort')).toBe('trendingScore');
		expect(last(calls, '/api/models').searchParams.get('direction')).toBe('-1');
		expect(last(calls, '/api/models').searchParams.has('filter')).toBe(false);

		const sidebar = page.locator('#listing-filters');
		await expect(sidebar.getByRole('tab', { name: 'Tasks' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await sidebar.getByRole('link', { name: 'Text Generation' }).click();
		await expect(page).toHaveURL('/models?pipeline_tag=text-generation');
		// Tasks use the hub's exact pipeline_tag parameter; `filter` would also match merely tagged repos.
		await expect
			.poll(() => last(calls, '/api/models').searchParams.getAll('pipeline_tag'))
			.toEqual(['text-generation']);
		expect(last(calls, '/api/models').searchParams.has('filter')).toBe(false);
		await expect(sidebar.getByRole('link', { name: 'Text Generation' })).toHaveAttribute(
			'aria-current',
			'true'
		);

		await sidebar.getByRole('tab', { name: 'Licenses' }).click();
		await sidebar.getByRole('link', { name: 'mit' }).click();
		await expect(page).toHaveURL('/models?pipeline_tag=text-generation&license=license%3Amit');
		await expect
			.poll(() => last(calls, '/api/models').searchParams.getAll('filter'))
			.toEqual(['license:mit']);
		expect(last(calls, '/api/models').searchParams.get('pipeline_tag')).toBe('text-generation');

		await page.getByLabel('Sort:').selectOption('likes');
		await expect(page).toHaveURL(
			'/models?pipeline_tag=text-generation&license=license%3Amit&sort=likes'
		);
		await expect.poll(() => last(calls, '/api/models').searchParams.get('sort')).toBe('likes');

		await page.getByRole('searchbox', { name: 'Filter by name' }).fill('bert');
		await expect(page).toHaveURL(
			'/models?pipeline_tag=text-generation&license=license%3Amit&search=bert&sort=likes'
		);
		await expect.poll(() => last(calls, '/api/models').searchParams.get('search')).toBe('bert');

		const active = page.getByRole('list', { name: 'Active filters' });
		await active.getByRole('link', { name: 'Remove text-generation' }).click();
		await expect(page).toHaveURL('/models?license=license%3Amit&search=bert&sort=likes');
		await expect
			.poll(() => last(calls, '/api/models').searchParams.has('pipeline_tag'))
			.toBe(false);
		expect(last(calls, '/api/models').searchParams.getAll('filter')).toEqual(['license:mit']);
	});

	test('applies the name filter after the debounce but drops it when navigating first', async ({
		page
	}) => {
		const calls = await mockHub(page);
		const errors: Error[] = [];
		page.on('pageerror', (error) => errors.push(error));
		await page.clock.install({ time: new Date('2026-09-18T00:00:00Z') });
		await page.goto('/models');
		const repo = page.getByRole('link', { name: 'openai-community/gpt2' });
		await expect(repo).toBeVisible();
		await page.clock.pauseAt(new Date('2026-09-18T01:00:00Z'));

		const search = page.getByRole('searchbox', { name: 'Filter by name' });
		await search.fill('bert');
		await page.clock.runFor(300);
		await expect(page).toHaveURL('/models?search=bert');
		await expect(search).toHaveValue('bert');

		// Link clicks navigate after a frame, so the clock must move a little for them to start.
		await search.fill('ber');
		await page.locator('#listing-filters').getByRole('link', { name: 'Text Generation' }).click();
		await page.clock.runFor(50);
		await expect(page).toHaveURL('/models?pipeline_tag=text-generation&search=bert');
		await page.clock.runFor(1000);
		await expect(page).toHaveURL('/models?pipeline_tag=text-generation&search=bert');
		await expect(search).toHaveValue('bert');

		await search.fill('gpt');
		await repo.click();
		await page.clock.runFor(50);
		await expect(page).toHaveURL('/openai-community/gpt2');
		await page.clock.runFor(1000);
		await expect(page).toHaveURL('/openai-community/gpt2');
		await expect(page.getByRole('heading', { name: 'GPT-2', level: 1 })).toBeVisible();
		expect(requests(calls, '/api/models').map((u) => u.searchParams.get('search'))).not.toContain(
			'ber'
		);
		expect(errors).toEqual([]);
	});

	test('follows the opaque cursor from the Link header and survives a reload', async ({ page }) => {
		const calls = await mockHub(page);
		await page.goto('/models?sort=likes');
		await expect(page.getByRole('link', { name: 'openai-community/gpt2' })).toBeVisible();
		await expect(page.getByTestId('listing-count')).toHaveCount(0);
		const next = page.getByRole('link', { name: 'Next' });
		await expect(page.getByRole('link', { name: 'Previous' })).toHaveCount(0);
		await next.click();
		await expect(page).toHaveURL('/models?sort=likes&cursor=c2');
		await expect(page.getByRole('link', { name: 'page-two/model' })).toBeVisible();
		expect(last(calls, '/api/models').searchParams.get('cursor')).toBe('c2');
		expect(last(calls, '/api/models').searchParams.get('sort')).toBe('likes');
		expect(calls.every((u) => u.origin === 'http://localhost:4173')).toBe(true);

		await page.reload();
		await expect(page.getByRole('link', { name: 'page-two/model' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Next' })).toHaveCount(0);
		await page.getByRole('link', { name: 'Previous' }).click();
		await expect(page).toHaveURL('/models?sort=likes');
		await expect(page.getByRole('link', { name: 'openai-community/gpt2' })).toBeVisible();

		await next.click();
		await expect(page).toHaveURL('/models?sort=likes&cursor=c2');
		await page.locator('#listing-filters').getByRole('link', { name: 'Fill-Mask' }).click();
		await expect(page).toHaveURL('/models?pipeline_tag=fill-mask&sort=likes');
		expect(last(calls, '/api/models').searchParams.has('cursor')).toBe(false);
	});

	test('prefixes dataset facets and accepts already prefixed hub urls', async ({ page }) => {
		const calls = await mockHub(page);
		await page.goto(
			'/datasets?task_categories=text-classification&language=language%3Aen&library=datasets'
		);
		await expect(page.getByRole('link', { name: 'openai/gsm8k' })).toBeVisible();
		expect(last(calls, '/api/datasets').searchParams.getAll('filter')).toEqual([
			'task_categories:text-classification',
			'library:datasets',
			'language:en'
		]);
		const sidebar = page.locator('#listing-filters');
		await expect(sidebar.getByRole('link', { name: 'Text Classification' })).toHaveAttribute(
			'aria-current',
			'true'
		);
		await sidebar.getByRole('tab', { name: 'Languages' }).click();
		await expect(sidebar.getByRole('link', { name: 'English' })).toHaveAttribute(
			'aria-current',
			'true'
		);
	});

	test('falls back to observed tags without tags-by-type but surfaces server errors', async ({
		page
	}) => {
		await mockHub(page, { tags: 404 });
		await page.goto('/models');
		const sidebar = page.locator('#listing-filters');
		await expect(sidebar.getByRole('link', { name: 'text-generation' })).toBeVisible();
		await expect(sidebar.getByRole('link', { name: 'fill-mask' })).toBeVisible();
		await sidebar.getByRole('tab', { name: 'Licenses' }).click();
		await expect(sidebar.getByRole('link', { name: 'mit' })).toHaveAttribute(
			'href',
			'/models?license=license%3Amit'
		);

		await mockHub(page, { tags: 500 });
		await page.goto('/models');
		await expect(sidebar.getByRole('alert')).toContainText('Could not load Filters: 500');
		await expect(page.getByRole('link', { name: 'openai-community/gpt2' })).toBeVisible();
	});

	test('spaces render as a gallery with sdk facets', async ({ page }) => {
		const calls = await mockHub(page);
		await page.goto('/spaces');
		await expect(page.getByRole('link', { name: /ai-notes/ })).toBeVisible();
		await expect(page.locator('article').getByText('static', { exact: true })).toBeVisible();
		await page.locator('#listing-filters').getByRole('link', { name: 'static' }).click();
		await expect(page).toHaveURL('/spaces?sdk=static');
		await expect
			.poll(() => last(calls, '/api/spaces').searchParams.getAll('filter'))
			.toEqual(['static']);
		expect(requests(calls, '/api/spaces-tags-by-type')).toHaveLength(0);
	});
});

test.describe('authors', () => {
	test('shows the hub profile with its repositories', async ({ page }) => {
		const calls = await mockHub(page);
		await page.goto('/julien-c');
		await expect(page.getByRole('heading', { name: 'Julien Chaumond', level: 1 })).toBeVisible();
		await expect(page.getByText('4.88k followers')).toBeVisible();
		await expect(page.locator('img[src="https://cdn-avatars.example/julien.jpeg"]')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Hugging Face' })).toHaveAttribute(
			'href',
			'/huggingface'
		);
		await expect(page.getByRole('heading', { name: /^Models 53/ })).toBeVisible();
		await expect(page.getByRole('link', { name: 'openai-community/gpt2' })).toBeVisible();
		expect(last(calls, '/api/models').searchParams.get('author')).toBe('julien-c');
		await expect(page.getByRole('link', { name: 'Browse all Datasets \u2192' })).toHaveAttribute(
			'href',
			'/datasets?author=julien-c'
		);
	});

	test('falls back to initials when the hub has no profile, and aliases legacy model ids', async ({
		page
	}) => {
		const calls = await mockHub(page);
		await page.goto('/alice-w');
		await expect(page.getByRole('heading', { name: 'alice-w', level: 1 })).toBeVisible();
		await expect(page.getByTestId('avatar-initials').first()).toHaveText('AW');
		await expect(page.getByRole('link', { name: 'openai-community/gpt2' })).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
		expect(requests(calls, '/api/models/alice-w')).toHaveLength(0);

		await page.goto('/gpt2');
		await expect(page).toHaveURL('/openai-community/gpt2');
		expect(requests(calls, '/api/models/gpt2')).toHaveLength(1);
	});

	test('keeps profile errors other than 404 visible', async ({ page }) => {
		await mockHub(page, { overview: 500 });
		await page.goto('/ghost');
		await expect(page.getByRole('alert').first()).toContainText('Could not load profile: 500');
	});
});

test.describe('repository pages', () => {
	test('redirects the /models alias to the root model path', async ({ page }) => {
		await mockHub(page);
		await page.goto('/models/openai-community/gpt2?x=1');
		await expect(page).toHaveURL('/openai-community/gpt2?x=1');
		await expect(page.getByRole('heading', { name: 'GPT-2', level: 1 })).toBeVisible();
	});

	test('renders the model card safely with true metadata', async ({ page }) => {
		const errors: Error[] = [];
		page.on('pageerror', (error) => errors.push(error));
		const calls = await mockHub(page);
		await page.addInitScript(() => localStorage.setItem('hfx.token', 'hf_good'));
		await page.goto('/openai-community/gpt2');

		const header = page.locator('header').nth(1);
		await expect(header.getByRole('link', { name: 'openai-community' })).toHaveAttribute(
			'href',
			'/openai-community'
		);
		await expect(header.getByRole('link', { name: 'gpt2', exact: true })).toBeVisible();
		await expect(header.getByText('4.14k')).toBeVisible();
		await expect(header.getByRole('link', { name: 'License: mit' })).toHaveAttribute(
			'href',
			'/models?license=license%3Amit'
		);
		await expect(header.getByRole('link', { name: 'text-generation' })).toHaveAttribute(
			'href',
			'/models?pipeline_tag=text-generation'
		);
		await expect(header.getByRole('link', { name: 'Model card' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(header.getByRole('link', { name: 'Files and versions' })).toHaveAttribute(
			'href',
			'/openai-community/gpt2/tree/main'
		);

		const card = page.locator('.markdown');
		await expect(card.getByRole('heading', { name: 'GPT-2', level: 1 })).toBeVisible();
		await expect(card.locator('h2#usage')).toHaveText('Usage');
		await expect(card.locator('code.language-python .hljs-keyword').first()).toHaveText('from');
		await expect(card.locator('table td').first()).toHaveText('train');
		await expect(card.locator('input[type=checkbox][disabled]')).toHaveCount(2);
		await expect(card.locator('.katex')).toHaveCount(1);
		await expect(
			card.locator('img[src="/openai-community/gpt2/resolve/main/assets/plot.png"]')
		).toHaveCount(1);
		await expect(card.locator('img[src="/openai-community/gpt2/resolve/main/x"]')).toHaveCount(1);
		await expect(card.getByRole('link', { name: 'docs' })).toHaveAttribute(
			'href',
			'/openai-community/gpt2/blob/main/docs/usage.md'
		);
		await expect(card.getByRole('link', { name: 'usage section' })).toHaveAttribute(
			'href',
			'#usage'
		);
		const external = card.getByRole('link', { name: 'here' });
		await expect(external).toHaveAttribute('target', '_blank');
		await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
		await expect(
			card.locator('script, iframe, [onerror], [href^="javascript"], [href^="data"]')
		).toHaveCount(0);
		await expect(card.locator('a:not([href])')).toHaveCount(2);
		expect(
			await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned)
		).toBeUndefined();
		expect(errors).toEqual([]);
		expect(requests(calls, '/openai-community/gpt2/resolve/main/README.md')).toHaveLength(1);

		const aside = page.getByRole('complementary', { name: 'Repository metadata' });
		await expect(aside.getByText('Downloads last month')).toBeVisible();
		await expect(aside.getByText('15,439,333')).toBeVisible();
		await expect(aside.getByText('137M params')).toBeVisible();
		await expect(aside.getByText('F32')).toBeVisible();
		await expect(aside.getByRole('link', { name: 'openai-community/gpt2-base' })).toHaveAttribute(
			'href',
			'/openai-community/gpt2-base'
		);
		await expect(aside.getByRole('link', { name: 'Finetunes \u2192' })).toHaveAttribute(
			'href',
			'/models?other=base_model%3Afinetune%3Aopenai-community%2Fgpt2'
		);
		await expect(aside.getByRole('heading', { name: 'Spaces using gpt2 (2)' })).toBeVisible();
		await aside.getByText('Use this model').click();
		const snippet = aside.locator('pre').first();
		await expect(snippet).toContainText('os.environ["HF_ENDPOINT"] = "http://localhost:4173"');
		await expect(snippet).toContainText(
			'pipeline("text-generation", model="openai-community/gpt2")'
		);
		await expect(aside).not.toContainText('huggingface.co');

		await header.getByRole('link', { name: 'Community', exact: true }).click();
		await expect(page).toHaveURL('/openai-community/gpt2/discussions');
		await expect(page.getByTestId('community-unavailable')).toContainText(
			'not available on this hub'
		);
	});

	test('sends the bearer token when fetching the README', async ({ page }) => {
		await mockHub(page);
		await page.addInitScript(() => localStorage.setItem('hfx.token', 'hf_good'));
		const readmeRequest = page.waitForRequest((r) => r.url().includes('/resolve/main/README.md'));
		await page.goto('/openai-community/gpt2');
		expect((await readmeRequest).headers()['authorization']).toBe('Bearer hf_good');
	});

	test('shows sparse hub metadata honestly', async ({ page }) => {
		await mockHub(page, {
			readme: 404,
			model: {
				id: 'openai-community/gpt2',
				sha: gpt2.sha,
				private: false,
				gated: false,
				downloads: 0,
				likes: 0,
				tags: ['license:mit'],
				siblings: [{ rfilename: 'model.safetensors' }],
				usedStorage: 0
			}
		});
		await page.goto('/openai-community/gpt2');
		await expect(page.getByText('No card yet')).toBeVisible();
		await expect(page.getByText('Parameter metadata unavailable')).toBeVisible();
		await expect(page.getByText('Downloads last month')).toBeVisible();
		await expect(page.getByText('Model tree for gpt2')).toBeVisible();
		await expect(page.getByText('Base model')).toHaveCount(0);
		await expect(page.getByText('Storage used')).toHaveCount(0);
	});

	test('surfaces missing and restricted repositories', async ({ page }) => {
		await mockHub(page, { info: 404 });
		await page.goto('/openai-community/gpt2');
		await expect(page.getByText('404')).toBeVisible();
		await expect(page.getByText('was not found on this hub')).toBeVisible();

		await mockHub(page, { info: 403 });
		await page.goto('/openai-community/gpt2');
		await expect(page.getByText('is private or gated')).toBeVisible();
		await expect(page.getByRole('main').getByRole('link', { name: 'Log In' })).toHaveAttribute(
			'href',
			'/login'
		);

		await mockHub(page, { info: 502 });
		await page.goto('/openai-community/gpt2');
		await expect(page.getByRole('alert')).toContainText('502');
		await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
	});

	test('renders the dataset card variant', async ({ page }) => {
		await mockHub(page);
		await page.goto('/datasets/openai/gsm8k');
		const header = page.locator('header').nth(1);
		await expect(header.getByRole('link', { name: 'Dataset card' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(
			header.getByRole('link', { name: 'Task categories: text-generation' })
		).toHaveAttribute('href', '/datasets?task_categories=task_categories%3Atext-generation');
		await expect(header.getByRole('link', { name: 'Files and versions' })).toHaveAttribute(
			'href',
			'/datasets/openai/gsm8k/tree/main'
		);
		const aside = page.getByRole('complementary', { name: 'Repository metadata' });
		await expect(aside.getByText('16,265')).toBeVisible();
		await expect(aside.getByText('5.89 MB')).toBeVisible();
		await expect(
			aside.getByRole('link', { name: /Models trained or fine-tuned on gsm8k/ })
		).toHaveAttribute('href', '/models?dataset=dataset%3Aopenai%2Fgsm8k');
		await aside.getByText('Use this dataset').click();
		await expect(aside.locator('pre').first()).toContainText('load_dataset("openai/gsm8k")');
		await expect(
			page.locator('.markdown img[src="/datasets/openai/gsm8k/resolve/main/assets/plot.png"]')
		).toHaveCount(1);
	});

	test('embeds only running spaces on a validated hf.space host', async ({ page }) => {
		await mockHub(page, { spaceHost: 'https://lynote-ai-notes.static.hf.space' });
		await page.goto('/spaces/lynote/ai-notes');
		const frame = page.locator('iframe');
		await expect(frame).toHaveAttribute('src', 'https://lynote-ai-notes.static.hf.space');
		await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
		await expect(page.getByRole('heading', { name: /AI Notes/ })).toBeVisible();
		await expect(page.getByRole('link', { name: 'App' })).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('link', { name: 'openai-community/gpt2' })).toBeVisible();

		await mockHub(page, { spaceHost: 'https://evil.example', spaceStage: 'RUNNING' });
		await page.goto('/spaces/lynote/ai-notes');
		await expect(page.getByTestId('space-app-empty')).toBeVisible();
		await expect(page.locator('iframe')).toHaveCount(0);

		await mockHub(page, { spaceHost: 'https://lynote-ai-notes.hf.space', spaceStage: 'SLEEPING' });
		await page.goto('/spaces/lynote/ai-notes');
		await expect(page.getByTestId('space-app-empty')).toContainText('SLEEPING');
	});
});

test.describe('responsive layout', () => {
	for (const width of [1440, 768, 390]) {
		test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
			await mockHub(page);
			await page.setViewportSize({ width, height: 900 });
			mkdirSync('reference/models', { recursive: true });
			mkdirSync('reference/model', { recursive: true });
			for (const [name, path, ready] of [
				['models', '/models', 'openai-community/gpt2'],
				['model', '/openai-community/gpt2', 'GPT-2']
			] as const) {
				await page.goto(path);
				await expect(page.getByText(ready).first()).toBeVisible();
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth
				);
				expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
				await page.screenshot({
					path: `reference/${name}/local-mock-${width}.png`,
					fullPage: true
				});
			}
			// Below the lg breakpoint the filter sidebar is a real toggle, not merely hidden.
			await page.goto('/models');
			const filters = page.locator('#listing-filters');
			const toggle = page.getByRole('button', { name: 'Filters' });
			if (width < 1024) {
				await expect(filters).toBeHidden();
				await toggle.click();
				await expect(toggle).toHaveAttribute('aria-expanded', 'true');
			} else {
				await expect(toggle).toBeHidden();
			}
			await expect(filters.getByRole('link', { name: 'Text Generation' })).toBeVisible();
		});
	}
});
