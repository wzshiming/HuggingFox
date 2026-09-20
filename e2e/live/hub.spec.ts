import { expect, test as base, type Page } from '@playwright/test';

// Read-only smoke against a real hub behind the preview proxy (pnpm test:live): no mocks, no writes.
// A failing test that saw an HTTP 429 reports the rate limit instead of a silent site regression.
const test = base.extend({
	page: async ({ page }, use, testInfo) => {
		const limited = new Set<string>();
		const errors: string[] = [];
		page.on('response', (res) => {
			if (res.status() === 429) limited.add(new URL(res.url()).pathname);
		});
		page.on('pageerror', (error) => errors.push(String(error)));
		await use(page);
		if (limited.size) {
			const paths = [...limited].join(', ');
			testInfo.annotations.push({ type: 'rate-limited', description: paths });
			if (testInfo.status !== 'passed')
				throw new Error(`HTTP 429 rate limited by the hub: ${paths}`);
		}
		expect(errors, 'uncaught page errors').toEqual([]);
	}
});

const MODEL = 'openai-community/gpt2';
const SHA = '607a30d783dfa663caf39e06633721c8d4cfcd7e';
const DATASET = 'stanfordnlp/imdb';
const slow = { timeout: 60_000 };

const cards = (page: Page) => page.locator('main article');
const noOverflow = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('home lists trending models, datasets and spaces', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'HuggingFox', level: 1 })).toBeVisible();
	for (const name of ['Models', 'Datasets', 'Spaces']) {
		const column = page.getByRole('heading', { name, level: 2, exact: true }).locator('..');
		await expect(column.locator('article').first()).toBeVisible(slow);
	}
	await expect(page.getByRole('contentinfo')).not.toContainText('Powered by');
	expect(await noOverflow(page)).toBe(0);
});

test('models: name search, sort, task filter and cursor paging', async ({ page }) => {
	// Each step waits for its own listing response, so assertions never read the previous page's cards.
	const listed = (match: (params: URLSearchParams) => boolean) =>
		page.waitForResponse((res) => {
			const url = new URL(res.url());
			return url.pathname === '/api/models' && res.ok() && match(url.searchParams);
		}, slow);
	const filtered = (p: URLSearchParams) => p.get('pipeline_tag') === 'text-generation';

	await page.goto('/models');
	await expect(cards(page).first()).toBeVisible(slow);

	let done = listed((p) => p.get('search') === 'bert');
	await page.getByRole('searchbox', { name: 'Filter by name' }).fill('bert');
	await done;
	await expect(page).toHaveURL(/search=bert/);
	await expect(cards(page).first()).toContainText(/bert/i, slow);

	done = listed((p) => p.get('search') === 'bert' && p.get('sort') === 'likes');
	await page.getByRole('combobox', { name: 'Sort:' }).selectOption('likes');
	await done;
	await expect(page).toHaveURL(/sort=likes/);
	await expect(cards(page).first()).toContainText(/bert/i, slow);

	await page.goto('/models');
	done = listed((p) => filtered(p) && !p.has('cursor'));
	await page
		.getByRole('list', { name: 'Tasks' })
		.getByRole('link', { name: 'Text Generation', exact: true })
		.click(slow);
	await done;
	await expect(page).toHaveURL(/pipeline_tag=text-generation/);
	await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('text-generation');
	await expect(cards(page)).toHaveCount(30, slow);
	for (const text of await cards(page).allInnerTexts()) expect(text).toContain('text-generation');

	const first = (await cards(page).first().innerText()).split('\n')[0];
	done = listed((p) => filtered(p) && p.has('cursor'));
	await page.getByRole('link', { name: 'Next' }).click();
	await done;
	await expect(page).toHaveURL(/cursor=/);
	await expect(cards(page)).toHaveCount(30, slow);
	expect((await cards(page).first().innerText()).split('\n')[0]).not.toBe(first);
	done = listed((p) => filtered(p) && !p.has('cursor'));
	await page.getByRole('link', { name: 'Previous' }).click();
	await done;
	await expect(page).toHaveURL(/\/models\?pipeline_tag=text-generation$/);
	await expect(cards(page).first()).toContainText(first, slow);
});

test('datasets and spaces listings load with their facets', async ({ page }) => {
	await page.goto('/datasets');
	await expect(cards(page).first()).toBeVisible(slow);
	await expect(page.getByRole('list', { name: 'Tasks' }).getByRole('link').first()).toBeVisible(
		slow
	);
	await page.goto('/spaces');
	await expect(cards(page).first()).toBeVisible(slow);
	await expect(page.getByRole('list', { name: 'SDK' }).getByRole('link').first()).toBeVisible(slow);
});

test('model card renders the README and hub metadata', async ({ page }) => {
	await page.goto(`/${MODEL}`);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('gpt2');
	const card = page.getByRole('region', { name: 'Card' });
	await expect(card.getByRole('heading', { name: 'GPT-2', exact: true })).toBeVisible(slow);
	const meta = page.getByRole('complementary', { name: 'Repository metadata' });
	await expect(meta).toContainText(/Downloads last month\s*[\d,.]+[kMB]?/);
	await expect(meta).toContainText(/Model size\s*\d+M params/);
	await expect(page.getByRole('link', { name: 'Files and versions' })).toHaveAttribute(
		'href',
		`/${MODEL}/tree/main`
	);
	await expect(
		page.getByRole('list', { name: 'Tags' }).getByRole('link', { name: 'License: mit' })
	).toHaveAttribute('href', '/models?license=license%3Amit');
});

test('dataset card, folder navigation and branch switching', async ({ page }) => {
	await page.goto(`/datasets/${DATASET}`);
	const meta = page.getByRole('complementary', { name: 'Repository metadata' });
	await expect(meta).toContainText(/Number of rows\s*[\d,]+/, slow);
	await page.getByRole('link', { name: 'Files and versions' }).click();
	await expect(page).toHaveURL(`/datasets/${DATASET}/tree/main`);
	const table = page.getByRole('table', { name: 'Files' });
	await expect(table.getByRole('link', { name: 'README.md', exact: true })).toBeVisible(slow);
	await table.getByRole('link', { name: 'plain_text', exact: true }).click();
	await expect(page).toHaveURL(`/datasets/${DATASET}/tree/main/plain_text`);
	await expect(table.getByRole('link', { name: /\.parquet$/ }).first()).toBeVisible(slow);
	await expect(table.getByRole('link', { name: 'Parent folder' })).toHaveAttribute(
		'href',
		`/datasets/${DATASET}/tree/main`
	);
	await table.getByRole('link', { name: 'Parent folder' }).click();
	await expect(table.getByRole('link', { name: 'plain_text', exact: true })).toBeVisible(slow);

	const picker = page.getByRole('button', { name: /^Switch branch or tag/ });
	await expect(picker).toContainText('main');
	await picker.click();
	await page.getByRole('link', { name: 'script', exact: true }).click();
	await expect(page).toHaveURL(`/datasets/${DATASET}/tree/script`);
	await expect(table.getByRole('link', { name: 'imdb.py', exact: true })).toBeVisible(slow);
	await expect(picker).toContainText('script');
});

test('model tree, README and config.json blobs, safetensors header only', async ({ page }) => {
	await page.goto(`/${MODEL}/tree/main`);
	const table = page.getByRole('table', { name: 'Files' });
	await expect(table.getByRole('link', { name: 'onnx', exact: true })).toBeVisible(slow);
	await expect(table.getByRole('row', { name: /model\.safetensors/ })).toContainText('LFS');
	await expect(page.getByRole('link', { name: /^History: \d+ commits$/ })).toHaveAttribute(
		'href',
		`/${MODEL}/commits/main`,
		slow
	);
	await table.getByRole('link', { name: 'onnx', exact: true }).click();
	await expect(table.getByRole('link', { name: 'decoder_model.onnx', exact: true })).toBeVisible(
		slow
	);

	await page.goto(`/${MODEL}/blob/main/README.md`);
	await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
		'aria-selected',
		'true',
		slow
	);
	await expect(page.getByRole('heading', { name: 'GPT-2', exact: true })).toBeVisible(slow);
	await page.getByRole('tab', { name: 'Code' }).click();
	await expect(page.getByTestId('code-view')).toContainText('license: mit');

	await page.goto(`/${MODEL}/blob/main/config.json`);
	await expect(page.getByTestId('code-view')).toContainText('GPT2LMHeadModel', slow);

	// Every weights request is ranged (redirect hops to the CDN are not re-reported with headers).
	const ranges: (string | undefined)[] = [];
	const partial: number[] = [];
	page.on('request', (req) => {
		if (req.url().includes('/resolve/main/model.safetensors') && !req.redirectedFrom()) {
			ranges.push(req.headers()['range']);
		}
	});
	page.on('response', (res) => {
		if (res.status() === 206) partial.push(Number(res.headers()['content-length']));
	});
	await page.goto(`/${MODEL}/blob/main/model.safetensors`);
	const tensors = page.getByTestId('tensor-view');
	await expect(tensors).toContainText(/Params\s*\d+M/, slow);
	await expect(tensors).toContainText('wte.weight');
	expect(ranges.length).toBeGreaterThan(0);
	for (const range of ranges) expect(range).toMatch(/^bytes=/);
	expect(partial.length).toBeGreaterThan(0);
	for (const length of partial) expect(length).toBeLessThan(1_000_000);
});

test('commit history and a first-parent diff', async ({ page }) => {
	await page.goto(`/${MODEL}/commits/main`);
	await expect(page.getByRole('heading', { name: /^Commits on / }).first()).toBeVisible(slow);
	await expect(page.getByRole('heading', { name: /^History: \d+ commits$/ })).toBeVisible();
	await page.getByRole('link', { name: '607a30d', exact: true }).click();
	await expect(page).toHaveURL(`/${MODEL}/commit/${SHA}`);
	await expect(page.getByTestId('commit-sha')).toContainText(SHA);
	await expect(page.getByTestId('diff-stats')).toContainText('+1', slow);
	const file = page.getByTestId('diff-file');
	await expect(file).toContainText('tokenizer_config.json');
	await expect(file).toContainText('model_max_length');
});

test('a running public Space embeds its app', async ({ page, request }) => {
	const res = await request.get(
		'/api/spaces?limit=20&sort=likes&direction=-1&expand%5B%5D=runtime'
	);
	expect(res.ok()).toBe(true);
	const spaces: { id: string; private?: boolean; runtime?: { stage?: string } }[] =
		await res.json();
	const running = spaces.find((s) => s.runtime?.stage === 'RUNNING' && !s.private);
	test.skip(!running, 'no running public Space among the 20 most liked');
	if (!running) return;
	await page.goto(`/spaces/${running.id}`);
	await expect(page.getByRole('link', { name: 'App', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.locator('iframe[title$=" app"]')).toHaveAttribute(
		'src',
		/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.hf\.space$/,
		slow
	);
});

test('author profile lists repositories', async ({ page }) => {
	await page.goto('/julien-c');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Julien', slow);
	await expect(page.locator('section[aria-labelledby="author-model"] article').first()).toBeVisible(
		slow
	);
	await expect(page.getByRole('link', { name: 'Browse all Models →' })).toHaveAttribute(
		'href',
		'/models?author=julien-c'
	);
});

test.describe('mobile', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('home and model card fit a phone screen', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
		await expect(cards(page).first()).toBeVisible(slow);
		expect(await noOverflow(page)).toBe(0);

		await page.goto(`/${MODEL}`);
		await expect(
			page
				.getByRole('region', { name: 'Card' })
				.getByRole('heading', { name: 'GPT-2', exact: true })
		).toBeVisible(slow);
		expect(await noOverflow(page)).toBe(0);

		await page.goto(`/${MODEL}/tree/main`);
		await expect(
			page
				.getByRole('table', { name: 'Files' })
				.getByRole('link', { name: 'config.json', exact: true })
		).toBeVisible(slow);
		expect(await noOverflow(page)).toBe(0);
	});
});
