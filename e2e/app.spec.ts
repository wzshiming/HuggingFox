import { expect, test, type Page, type Request, type Route } from '@playwright/test';

const repo = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	likes: 12,
	downloads: 3400,
	lastModified: '2026-09-10T00:00:00.000Z',
	...extra
});

const quick = {
	models: [{ _id: '1', id: 'google/bert', trendingWeight: 1 }],
	datasets: [{ _id: '2', id: 'nyu-mll/glue', trendingWeight: 1 }],
	spaces: [],
	users: [{ _id: '3', user: 'alice', fullname: 'Alice', avatarUrl: '' }],
	orgs: []
};

// Serves the hub API from fixtures so the smoke run does not depend on an upstream.
async function mockHub(page: Page, { quicksearch = 200 } = {}) {
	await page.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		const json = (body: unknown, status = 200) =>
			route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		if (url.pathname === '/api/quicksearch') {
			if (quicksearch !== 200) return json({ error: 'not found' }, quicksearch);
			return json(quick);
		}
		if (url.pathname === '/api/whoami-v2') {
			const auth = route.request().headers()['authorization'];
			if (auth === 'Bearer hf_good')
				return json({ type: 'user', name: 'alice', fullname: 'Alice' });
			return json({ error: 'Invalid username or password.' }, 401);
		}
		if (url.pathname === '/api/models') {
			return json(
				url.searchParams.has('search')
					? [repo('fallback/bert-model')]
					: [repo('openai-community/gpt2', { pipeline_tag: 'text-generation' })]
			);
		}
		if (url.pathname === '/api/datasets') return json([repo('nyu-mll/glue')]);
		if (url.pathname === '/api/spaces') return json([]);
		return json({ error: 'not mocked' }, 404);
	});
}

// Parks quicksearch requests so the test decides when (or whether) their response arrives.
async function holdQuicksearch(page: Page) {
	const held: Route[] = [];
	await page.route('**/api/quicksearch**', (route) => void held.push(route));
	return held;
}

// Resolves once the page has consumed the response or aborted the request.
function settled(page: Page, request: Request) {
	return Promise.race([
		page.waitForEvent('requestfinished', (r) => r === request),
		page.waitForEvent('requestfailed', (r) => r === request)
	]);
}

test('renders the home page shell with trending lists', async ({ page }) => {
	await mockHub(page);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'HuggingFox', level: 1 })).toBeVisible();
	const nav = page.getByRole('navigation', { name: 'Main' });
	await expect(nav.getByRole('link', { name: 'Models' })).toHaveAttribute('href', '/models');
	await expect(nav.getByRole('link', { name: 'Log In' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'openai-community/gpt2' })).toBeVisible();
	await expect(page.getByText('text-generation')).toBeVisible();
	await expect(page.getByRole('link', { name: 'nyu-mll/glue' })).toBeVisible();
	await expect(page.getByText('Nothing here yet.')).toBeVisible();
	await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Datasets' })).toBeVisible();
});

test('search dropdown uses quicksearch and supports keyboard navigation', async ({ page }) => {
	await mockHub(page);
	await page.goto('/');
	const search = page.getByRole('combobox', { name: 'Search' });
	await search.fill('bert');
	const listbox = page.getByRole('listbox', { name: 'Search results' });
	await expect(listbox.getByRole('option', { name: 'google/bert' })).toBeVisible();
	await expect(listbox.getByRole('option', { name: 'alice' })).toBeVisible();
	await search.press('Escape');
	await expect(listbox).toBeHidden();
	await search.press('ArrowDown');
	await expect(listbox.getByRole('option', { name: 'google/bert' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await search.press('Enter');
	await expect(page).toHaveURL('/google/bert');
});

test('search falls back to the list endpoints when quicksearch is unavailable', async ({
	page
}) => {
	await mockHub(page, { quicksearch: 404 });
	await page.goto('/');
	const search = page.getByRole('combobox', { name: 'Search' });
	await search.fill('bert');
	await expect(page.getByRole('option', { name: 'fallback/bert-model' })).toBeVisible();
	await search.press('Enter');
	await expect(page).toHaveURL('/models?search=bert');
});

test('submitting after clearing a selected result does not throw', async ({ page }) => {
	await mockHub(page);
	const errors: Error[] = [];
	page.on('pageerror', (error) => errors.push(error));
	await page.goto('/');
	const search = page.getByRole('combobox', { name: 'Search' });
	await search.fill('bert');
	const option = page.getByRole('option', { name: 'google/bert' });
	await expect(option).toBeVisible();
	await search.press('ArrowDown');
	await expect(option).toHaveAttribute('aria-selected', 'true');
	await search.fill('');
	await expect(page.getByRole('listbox', { name: 'Search results' })).toBeHidden();
	await search.press('Enter');
	await expect(page).toHaveURL('/');
	expect(errors).toEqual([]);
});

test('typing a new query drops the previous results, even when their response is late', async ({
	page
}) => {
	await mockHub(page);
	const held = await holdQuicksearch(page);
	await page.clock.install({ time: new Date('2026-09-18T00:00:00Z') });
	await page.goto('/');
	await page.clock.pauseAt(new Date('2026-09-18T01:00:00Z'));
	const search = page.getByRole('combobox', { name: 'Search' });
	const listbox = page.getByRole('listbox', { name: 'Search results' });
	await search.fill('bert');
	await page.clock.runFor(200);
	await expect.poll(() => held.length).toBe(1);
	await held[0].fulfill({ json: quick });
	await expect(listbox.getByRole('option', { name: 'google/bert' })).toBeVisible();
	await search.fill('glue');
	await expect(listbox).toBeHidden();
	await page.clock.runFor(200);
	await expect.poll(() => held.length).toBe(2);
	const late = settled(page, held[1].request());
	await search.fill('bert');
	await held[1].fulfill({ json: { ...quick, models: [{ _id: '9', id: 'stale/glue' }] } });
	await late;
	await expect(listbox).toBeHidden();
	await page.clock.runFor(200);
	await expect.poll(() => held.length).toBe(3);
	await held[2].fulfill({ json: quick });
	await expect(listbox.getByRole('option', { name: 'google/bert' })).toBeVisible();
	await expect(page.getByRole('option', { name: 'stale/glue' })).toHaveCount(0);
});

test('logs in with a validated token and signs out again', async ({ page }) => {
	await mockHub(page);
	await page.goto('/join');
	await expect(page).toHaveURL('/login');
	const token = page.getByLabel('Access token');
	await token.fill('hf_bad');
	await page.getByRole('button', { name: 'Log In' }).click();
	await expect(page.getByRole('alert')).toContainText('not accepted');
	await expect(page.getByRole('alert')).not.toContainText('hf_bad');
	await token.fill('hf_good');
	await page.getByRole('button', { name: 'Log In' }).click();
	await expect(page).toHaveURL('/');
	expect(await page.evaluate(() => localStorage.getItem('hfx.token'))).toBe('hf_good');
	await page.getByRole('button', { name: 'Account menu' }).click();
	await expect(page.getByRole('menu')).toContainText('alice');
	await page.getByRole('menuitem', { name: 'Sign Out' }).click();
	expect(await page.evaluate(() => localStorage.getItem('hfx.token'))).toBe(null);
	await expect(page.getByRole('link', { name: 'Log In' })).toBeVisible();
});

test('signing out clears the search results', async ({ page }) => {
	await mockHub(page);
	await page.addInitScript(() => localStorage.setItem('hfx.token', 'hf_good'));
	await page.goto('/');
	const account = page.getByRole('button', { name: 'Account menu' });
	await expect(account).toBeVisible();
	const search = page.getByRole('combobox', { name: 'Search' });
	await search.fill('bert');
	const listbox = page.getByRole('listbox', { name: 'Search results' });
	await expect(listbox.getByRole('option', { name: 'google/bert' })).toBeVisible();
	await account.click();
	await page.getByRole('menuitem', { name: 'Sign Out' }).click();
	await expect(page.getByRole('link', { name: 'Log In' })).toBeVisible();
	await search.focus();
	await expect(listbox).toBeHidden();
});

test('a search response that arrives after signing out is discarded', async ({ page }) => {
	await mockHub(page);
	const held = await holdQuicksearch(page);
	await page.addInitScript(() => localStorage.setItem('hfx.token', 'hf_good'));
	await page.goto('/');
	const account = page.getByRole('button', { name: 'Account menu' });
	await expect(account).toBeVisible();
	const search = page.getByRole('combobox', { name: 'Search' });
	await search.fill('bert');
	await expect.poll(() => held.length).toBe(1);
	const late = settled(page, held[0].request());
	await account.click();
	await page.getByRole('menuitem', { name: 'Sign Out' }).click();
	await expect(page.getByRole('link', { name: 'Log In' })).toBeVisible();
	await held[0].fulfill({ json: quick });
	await late;
	await search.focus();
	await expect(page.getByRole('listbox', { name: 'Search results' })).toBeHidden();
});

test('mobile menu and theme toggle', async ({ page }) => {
	await mockHub(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.getByRole('banner').getByRole('link', { name: 'HuggingFox' })).toHaveAttribute(
		'href',
		'/'
	);
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
	await page.getByRole('button', { name: 'Open menu' }).click();
	const nav = page.getByRole('navigation', { name: 'Main' });
	await expect(nav.getByRole('link', { name: 'Datasets' })).toBeVisible();
	await nav.getByRole('button', { name: /^Theme/ }).click();
	await nav.getByRole('button', { name: /^Theme/ }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	expect(await page.evaluate(() => localStorage.getItem('hfx.theme'))).toBe('dark');
});

test('shows the not-found page inside the shell', async ({ page }) => {
	await mockHub(page);
	await page.goto('/no/such/page/here');
	await expect(page.getByText('404')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Back to the homepage' })).toBeVisible();
});

test('serves the SPA shell for app routes', async ({ request }) => {
	const response = await request.get('/user/repo');
	expect(response.headers()['content-type']).toContain('text/html');
});

// Reaches the preview server's proxy and its upstream (the fixture upstream in the default run).
test('does not fall back to the SPA shell for hub routes', async ({ request }) => {
	const response = await request.get('/api/nope', { maxRedirects: 0 });
	expect(response.headers()['content-type'] ?? '').not.toContain('text/html');
	expect(response.headers()['content-type'] ?? '').toContain('application/json');
	expect(response.status()).toBeGreaterThanOrEqual(400);
	expect(response.status()).toBeLessThan(500);
});
