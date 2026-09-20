import { expect, test, type Page } from '@playwright/test';
import { BIG_SHA, EMPTY_SHA, mockFilesHub, REPO, ROOT_SHA, SHA } from './fixtures/files.ts';

test.use({ timezoneId: 'UTC', locale: 'en-US' });

const base = `/${REPO}`;
const requests = (calls: URL[], path: string) => calls.filter((u) => u.pathname === path);
const pwned = (page: Page) => page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned);

test.describe('files', () => {
	test('browses folders with sizes, LFS markers, breadcrumbs and an opaque load-more link', async ({
		page
	}) => {
		const calls = await mockFilesHub(page);
		await page.goto(`${base}/tree/main`);
		await expect(page.getByRole('link', { name: 'Files and versions' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		const table = page.getByRole('table', { name: 'Files' });
		await expect(table.getByRole('row', { name: /config\.json/ })).toContainText('665 B');
		const weights = table.getByRole('row', { name: /model\.safetensors/ });
		await expect(weights).toContainText('LFS');
		await expect(weights).toContainText('548 MB');
		await expect(weights).toContainText('Fixture: adding safetensors variant (#1)');
		await expect(table.getByRole('link', { name: 'assets' })).toHaveAttribute(
			'href',
			`${base}/tree/main/assets`
		);
		await expect(table.getByRole('link', { name: 'config.json', exact: true })).toHaveAttribute(
			'href',
			`${base}/blob/main/config.json`
		);
		await expect(table.getByRole('link', { name: 'Download config.json' })).toHaveAttribute(
			'href',
			`${base}/resolve/main/config.json?download=true`
		);
		// Directories first, then the hub order.
		const names = await table.locator('tbody tr td:first-child a').allInnerTexts();
		expect(names.slice(0, 3)).toEqual(['assets', 'docs', 'feat']);
		await expect(page.getByTestId('latest-commit')).toContainText(
			'Fixture: adding safetensors variant (#1)'
		);
		await expect(
			page.getByTestId('latest-commit').getByRole('link', { name: '607a30d' })
		).toHaveAttribute('href', `${base}/commit/${SHA}`);
		await expect(page.getByRole('link', { name: 'History: 25 commits' })).toHaveAttribute(
			'href',
			`${base}/commits/main`
		);

		await expect(table.getByRole('link', { name: 'vocab.json', exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Load more files' }).click();
		await expect(table.getByRole('link', { name: 'vocab.json', exact: true })).toBeVisible();
		const tree = requests(calls, `/api/models/${REPO}/tree/main`);
		expect(tree.map((u) => u.searchParams.get('cursor'))).toEqual([null, 'c2']);
		expect(tree[1].searchParams.get('expand')).toBe('true');
		expect(calls.every((u) => u.origin === 'http://localhost:4173')).toBe(true);
		await expect(page.getByRole('button', { name: 'Load more files' })).toHaveCount(0);

		await table.getByRole('link', { name: 'assets' }).click();
		await expect(page).toHaveURL(`${base}/tree/main/assets`);
		await expect(table.getByRole('link', { name: 'plot.png', exact: true })).toHaveAttribute(
			'href',
			`${base}/blob/main/assets/plot.png`
		);
		await expect(table.getByRole('link', { name: 'vocab.json', exact: true })).toHaveCount(0);
		const crumbs = page.getByRole('navigation', { name: 'Files' });
		await expect(crumbs.getByRole('link', { name: 'gpt2' })).toHaveAttribute(
			'href',
			`${base}/tree/main`
		);
		await expect(crumbs.getByText('assets')).toHaveAttribute('aria-current', 'page');
		await expect(crumbs.getByRole('button', { name: 'Copy path' })).toBeVisible();
		await expect(table.getByRole('link', { name: 'Parent folder' })).toHaveAttribute(
			'href',
			`${base}/tree/main`
		);
	});

	test('keeps slash branches apart from folders and preserves the path across refs', async ({
		page
	}) => {
		const calls = await mockFilesHub(page);
		await page.goto(`${base}/tree/main/feat/branch`);
		const table = page.getByRole('table', { name: 'Files' });
		await expect(table.getByRole('link', { name: 'deep.txt', exact: true })).toBeVisible();
		const picker = page.getByRole('button', { name: /^Switch branch or tag/ });
		await expect(picker).toContainText('main');

		await page.goto(`${base}/tree/feat%2Fbranch`);
		await expect(
			table.getByRole('link', { name: 'only-on-branch.txt', exact: true })
		).toBeVisible();
		await expect(picker).toContainText('feat/branch');
		expect(requests(calls, `/api/models/${REPO}/tree/feat%2Fbranch`)).toHaveLength(1);
		await expect(page.getByRole('link', { name: 'History: 2 commits' })).toHaveAttribute(
			'href',
			`${base}/commits/feat%2Fbranch`
		);

		await page.goto(`${base}/tree/main/feat`);
		await expect(table.getByRole('link', { name: 'note.txt', exact: true })).toBeVisible();
		await picker.click();
		const search = page.getByRole('searchbox', { name: 'Filter branches and tags' });
		await search.fill('feat');
		await expect(page.getByRole('link', { name: 'feat/branch' })).toHaveAttribute(
			'href',
			`${base}/tree/feat%2Fbranch/feat`
		);
		await expect(page.getByRole('link', { name: 'main', exact: true })).toHaveCount(0);
		await page.getByRole('tab', { name: /^Tags/ }).click();
		await expect(page.getByText('No matching branches or tags.')).toBeVisible();
		await search.fill('');
		await expect(page.getByRole('link', { name: 'v1.0' })).toHaveAttribute(
			'href',
			`${base}/tree/v1.0/feat`
		);
		await page.getByRole('tab', { name: /^Branches/ }).click();
		await page.getByRole('link', { name: 'feat/branch' }).click();
		await expect(page).toHaveURL(`${base}/tree/feat%2Fbranch/feat`);
		await expect(page.getByText('No such file or folder at this revision.')).toBeVisible();
		await page.getByRole('link', { name: 'gpt2', exact: true }).last().click();
		await expect(page).toHaveURL(`${base}/tree/feat%2Fbranch`);
		await expect(
			table.getByRole('link', { name: 'only-on-branch.txt', exact: true })
		).toBeVisible();

		// Convert refs are addressed by their full ref, so the slashes must not become folders.
		await page.goto(`${base}/tree/refs%2Fconvert%2Fparquet/default`);
		await expect(
			table.getByRole('link', { name: 'train-00000-of-00001.parquet', exact: true })
		).toHaveAttribute(
			'href',
			`${base}/blob/refs%2Fconvert%2Fparquet/default/train-00000-of-00001.parquet`
		);
		await expect(picker).toContainText('refs/convert/parquet');
		expect(
			requests(calls, `/api/models/${REPO}/tree/refs%2Fconvert%2Fparquet/default`)
		).toHaveLength(1);
	});

	test('surfaces missing, restricted and failing listings', async ({ page }) => {
		await mockFilesHub(page);
		await page.goto(`${base}/tree/main/nope`);
		await expect(page.getByText('No such file or folder at this revision.')).toBeVisible();

		await mockFilesHub(page, { tree: 403 });
		await page.goto(`${base}/tree/main`);
		await expect(page.getByText('You need access to this repository')).toBeVisible();
		await expect(page.getByRole('main').getByRole('link', { name: 'Log In' })).toHaveAttribute(
			'href',
			'/login'
		);

		await mockFilesHub(page, { tree: 502 });
		await page.goto(`${base}/tree/main`);
		await expect(page.getByRole('alert')).toContainText('502');
		await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
	});

	test('fits narrow screens without horizontal page overflow', async ({ page }) => {
		await mockFilesHub(page);
		await page.setViewportSize({ width: 390, height: 844 });
		const overflow = () =>
			page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
		await page.goto(`${base}/tree/main`);
		await expect(page.getByRole('link', { name: 'model.safetensors', exact: true })).toBeVisible();
		expect(await overflow()).toBe(0);
		await page.goto(`${base}/blob/main/config.json`);
		await expect(page.getByTestId('code-view')).toBeVisible();
		expect(await overflow()).toBe(0);
		await page.goto(`${base}/blob/main/model.safetensors`);
		const tensorName = page.getByTestId('tensor-view').getByRole('cell', {
			name: 'model.embed.weight',
			exact: true
		});
		await expect(tensorName).toBeVisible();
		const nameSize = await tensorName.boundingBox();
		expect(nameSize?.width).toBeGreaterThanOrEqual(200);
		expect(nameSize?.height).toBeLessThan(40);
		expect(await overflow()).toBe(0);
		await page.goto(`${base}/commits/main`);
		await expect(page.getByRole('heading', { name: 'History: 25 commits' })).toBeVisible();
		expect(await overflow()).toBe(0);
		await page.goto(`${base}/commit/${SHA}`);
		await expect(page.getByTestId('diff-file').first()).toBeVisible();
		expect(await overflow()).toBe(0);
	});
});

test.describe('blob', () => {
	test('renders code with line numbers and highlighting and markdown with a source toggle', async ({
		page
	}) => {
		const errors: Error[] = [];
		page.on('pageerror', (error) => errors.push(error));
		await mockFilesHub(page);
		await page.goto(`${base}/blob/main/config.json`);
		const code = page.getByTestId('code-view');
		await expect(code.locator('.hljs-attr').first()).toHaveText('"activation_function"');
		await expect(code.locator('[aria-hidden] > div').last()).toHaveText('7');
		await expect(page.getByText('665 B')).toBeVisible();
		await expect(page.getByText('Blob ID')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Raw' })).toHaveAttribute(
			'href',
			`${base}/resolve/main/config.json`
		);
		await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute(
			'href',
			`${base}/resolve/main/config.json?download=true`
		);
		await expect(page.getByRole('link', { name: 'History' })).toHaveAttribute(
			'href',
			`${base}/commits/main`
		);
		await expect(page.getByTestId('latest-commit')).toContainText('Fixture: update config.json');
		await expect(page.getByRole('button', { name: /^Switch branch or tag/ })).toContainText('main');
		await expect(
			page.getByRole('navigation', { name: 'Files' }).getByText('config.json')
		).toHaveAttribute('aria-current', 'page');

		await page.goto(`${base}/blob/main/README.md`);
		const card = page.locator('.markdown');
		await expect(card.getByRole('heading', { name: 'GPT-2 fixture', level: 1 })).toBeVisible();
		await expect(card.getByRole('link', { name: 'usage docs' })).toHaveAttribute(
			'href',
			`${base}/blob/main/docs/usage.md`
		);
		await expect(card.locator('img')).toHaveAttribute(
			'src',
			`${base}/resolve/main/assets/plot.png`
		);
		await expect(card.locator('script')).toHaveCount(0);
		await page.getByRole('tab', { name: 'Code' }).click();
		await expect(code).toContainText('license: mit');
		await expect(card).toHaveCount(0);

		await page.goto(`${base}/blob/main/docs/usage.md`);
		await expect(card.getByRole('link', { name: 'readme' })).toHaveAttribute(
			'href',
			`${base}/blob/main/README.md`
		);
		await expect(card.getByRole('link', { name: 'api' })).toHaveAttribute(
			'href',
			`${base}/blob/main/docs/api.md`
		);
		await expect(card.locator('img')).toHaveAttribute(
			'src',
			`${base}/resolve/main/docs/images/a.png`
		);
		expect(await pwned(page)).toBeUndefined();
		expect(errors).toEqual([]);
	});

	test('previews images from a bounded in-app fetch and falls back for binaries and big files', async ({
		page
	}) => {
		const calls = await mockFilesHub(page);
		await page.goto(`${base}/blob/main/logo.png`);
		const img = page.getByRole('img', { name: 'logo.png' });
		await expect(img).toHaveAttribute('src', /^blob:/);
		await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);

		await page.goto(`${base}/blob/main/weights.bin`);
		const fallback = page.getByTestId('binary-fallback');
		await expect(fallback).toContainText('binary and cannot be previewed');
		await expect(fallback.getByRole('link', { name: /^Download/ })).toHaveAttribute(
			'href',
			`${base}/resolve/main/weights.bin?download=true`
		);
		const lfs = page.getByRole('definition').filter({ hasText: 'c'.repeat(64) });
		await expect(lfs).toBeVisible();
		await expect(page.getByText('Size of remote file')).toBeVisible();
		await expect(page.getByText('4.19 MB').first()).toBeVisible();
		expect(requests(calls, `${base}/resolve/main/weights.bin`)).toHaveLength(0);

		await page.goto(`${base}/blob/main/blob.dat`);
		await expect(page.getByTestId('binary-fallback')).toBeVisible();

		await page.goto(`${base}/blob/main/mystery.xyz`);
		await expect(page.getByTestId('code-view')).toContainText('plain text, no extension');

		await page.goto(`${base}/blob/main/big.txt`);
		await expect(page.getByRole('status')).toContainText('exceeds the 2.1 MB preview limit');
		await expect(page.getByTestId('code-view')).toHaveCount(0);

		await page.goto(`${base}/blob/main/nope.txt`);
		await expect(page.getByText('No such file or folder at this revision.')).toBeVisible();

		await page.goto(`${base}/blob/main/private.txt`);
		await expect(page.getByText('You need access to this repository')).toBeVisible();
		await expect(page.getByRole('main').getByRole('link', { name: 'Log In' })).toBeVisible();
		await page.addInitScript(() => localStorage.setItem('hfx.token', 'hf_good'));
		await page.reload();
		await expect(page.getByTestId('code-view')).toContainText('secret');
	});

	test('reads safetensors and gguf headers with ranged requests only', async ({ page }) => {
		const ranged: (string | undefined)[] = [];
		page.on('request', (request) => {
			if (/\/resolve\/.*(?:model\.safetensors|tiny\.gguf)$/.test(request.url()))
				ranged.push(request.headers()['range']);
		});
		await mockFilesHub(page);
		await page.goto(`${base}/blob/main/model.safetensors`);
		const view = page.getByTestId('tensor-view');
		await expect(view.getByRole('definition').first()).toHaveText('10 (F32 6, BF16 4)');
		await expect(view.getByRole('row', { name: /model\.embed\.weight/ })).toContainText('F32');
		await expect(view.getByRole('row', { name: /model\.embed\.weight/ })).toContainText('2 × 3');
		await expect(view.getByRole('row', { name: /model\.embed\.weight/ })).toContainText('24');
		await expect(view.getByRole('row', { name: /^format/ })).toContainText('pt');
		await expect(page.getByText('Xet hash')).toBeVisible();
		await expect(page.getByText('d'.repeat(64))).toBeVisible();
		await expect(page.getByText('548 MB').first()).toBeVisible();

		await page.goto(`${base}/blob/main/tiny.gguf`);
		await expect(view.getByRole('definition').first()).toHaveText('llama');
		await expect(view.getByRole('row', { name: /blk\.0\.attn_q\.weight/ })).toContainText('F32');
		await expect(view.getByRole('row', { name: /tokenizer\.ggml\.tokens/ })).toContainText(
			'[3] <s>, hello, world'
		);
		await expect(view.getByRole('row', { name: /general\.name/ })).toContainText('tiny-fixture');
		expect(ranged.length).toBeGreaterThan(0);
		expect(ranged.every((range) => range?.startsWith('bytes='))).toBe(true);
	});
});

test.describe('history', () => {
	test('pages through commits grouped by day with copyable shas and browse links', async ({
		page
	}) => {
		const calls = await mockFilesHub(page);
		await page.goto(`${base}/commits/main`);
		await expect(page.getByRole('heading', { name: 'History: 25 commits' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Commits on Feb 19, 2024' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Commits on Feb 16, 2024' })).toBeVisible();
		await expect(page.getByRole('heading', { name: /^Commits on/ })).toHaveCount(2);
		const items = page.locator('ol > li');
		await expect(items).toHaveCount(20);
		const first = items.first();
		await expect(
			first.getByRole('link', { name: 'Fixture: adding safetensors variant (#1)' })
		).toHaveAttribute('href', `${base}/commit/${SHA}`);
		await expect(first.getByRole('link', { name: '607a30d' })).toBeVisible();
		await expect(first.getByRole('button', { name: 'Copy full commit hash' })).toBeVisible();
		await expect(first.getByRole('link', { name: 'Browse files' })).toHaveAttribute(
			'href',
			`${base}/tree/${SHA}`
		);
		await expect(first.getByRole('link', { name: 'julien-c' })).toHaveAttribute(
			'href',
			'/julien-c'
		);
		await expect(first.locator('time')).toHaveAttribute('datetime', '2024-02-19T20:57:45.000Z');
		await expect(page.getByRole('link', { name: 'Previous' })).toHaveCount(0);

		await page.getByRole('link', { name: 'Next' }).click();
		await expect(page).toHaveURL(`${base}/commits/main?p=1`);
		await expect(page.getByRole('heading', { name: 'Commits on Feb 13, 2024' })).toBeVisible();
		await expect(items).toHaveCount(5);
		await expect(page.getByRole('link', { name: 'Next' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Previous' })).toHaveAttribute(
			'href',
			`${base}/commits/main`
		);
		const list = requests(calls, `/api/models/${REPO}/commits/main`);
		expect(list.map((u) => [u.searchParams.get('p'), u.searchParams.get('limit')])).toEqual([
			['0', '20'],
			['1', '20']
		]);

		await page.goto(`${base}/commits/feat%2Fbranch`);
		await expect(page.getByRole('heading', { name: 'History: 2 commits' })).toBeVisible();
		await expect(page.getByRole('button', { name: /^Switch branch or tag/ })).toContainText(
			'feat/branch'
		);
		expect(requests(calls, `/api/models/${REPO}/commits/feat%2Fbranch`)).toHaveLength(1);
	});

	test('shows a commit with its first-parent diff, escaped, with stats and binary notes', async ({
		page
	}) => {
		const errors: Error[] = [];
		page.on('pageerror', (error) => errors.push(error));
		const calls = await mockFilesHub(page);
		await page.goto(`${base}/commit/${SHA}`);
		await expect(
			page.getByRole('heading', { name: 'Fixture: adding safetensors variant (#1)', level: 2 })
		).toBeVisible();
		await expect(page.locator('article header pre')).toContainText('<script>alert(1)</script>');
		await expect(page.getByTestId('commit-sha')).toHaveText(SHA);
		await expect(page.getByRole('link', { name: 'Browse files' })).toHaveAttribute(
			'href',
			`${base}/tree/${SHA}`
		);
		await expect(page.getByRole('link', { name: 'Files and versions' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(page.getByTestId('diff-stats')).toHaveText(/4 files changed\s+\+5\s+−2/);
		const files = page.getByTestId('diff-file');
		await expect(files).toHaveCount(4);
		await expect(files.nth(0)).toContainText('New intro <img src=x onerror="window.pwned = true">');
		await expect(files.nth(0).locator('img')).toHaveCount(0);
		await expect(files.nth(0)).toContainText('@@ -1,4 +1,5 @@');
		await expect(files.nth(1)).toContainText('model.safetensors');
		await expect(files.nth(1)).toContainText('added');
		await expect(files.nth(2)).toContainText('deleted');
		await expect(files.nth(3)).toContainText('Binary file not shown.');
		expect(await pwned(page)).toBeUndefined();
		expect(errors).toEqual([]);
		const compare = calls.filter((u) => u.pathname.includes('/compare/'));
		expect(compare.map((u) => u.pathname)).toEqual([
			`/api/models/${REPO}/compare/${SHA}%5E..${SHA}`
		]);
		expect(compare[0].search).toBe('');
		const meta = requests(calls, `/api/models/${REPO}/commits/${SHA}`);
		expect(meta).toHaveLength(1);
		expect(meta[0].searchParams.get('limit')).toBe('1');
	});

	test('tells a root commit from an unavailable diff and copes with empty or huge patches', async ({
		page
	}) => {
		await mockFilesHub(page);
		await page.goto(`${base}/commit/${ROOT_SHA}`);
		await expect(page.getByRole('heading', { name: 'Fixture: initial commit' })).toBeVisible();
		await expect(page.getByRole('status')).toContainText('first commit in its history');
		await expect(page.getByTestId('diff-file')).toHaveCount(0);

		await page.goto(`${base}/commit/${EMPTY_SHA}`);
		await expect(page.getByRole('status')).toContainText('changed no files');

		await page.goto(`${base}/commit/${BIG_SHA}`);
		await expect(page.getByRole('status')).toContainText('The patch exceeds 2.1 MB');
		await expect(page.getByTestId('diff-stats')).toHaveCount(0);

		await page.goto(`${base}/commit/deadbeef`);
		await expect(page.getByText('Commit deadbeef was not found.')).toBeVisible();
	});
});
