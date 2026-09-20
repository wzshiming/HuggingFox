import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
	mockManagementHub,
	navigate,
	ndjson,
	REPO,
	requests,
	SECOND,
	SPACE_SHA
} from './fixtures/management.ts';

test.use({ timezoneId: 'UTC', locale: 'en-US' });

const base = `/${REPO}`;
const signIn = (page: Page, token = 'hf_good') =>
	page.addInitScript((value) => localStorage.setItem('hfx.token', value), token);

test.describe('management', () => {
	test('account menu links to my repositories and the new-repo pages, on desktop and mobile', async ({
		page
	}) => {
		await mockManagementHub(page);
		await signIn(page);
		await page.goto('/');
		await page.getByRole('button', { name: 'Account menu' }).click();
		const menu = page.getByRole('menu');
		await expect(menu.getByRole('menuitem', { name: 'My repositories' })).toHaveAttribute(
			'href',
			'/settings/repositories'
		);
		await expect(menu.getByRole('menuitem', { name: 'New model' })).toHaveAttribute('href', '/new');
		await expect(menu.getByRole('menuitem', { name: 'New dataset' })).toHaveAttribute(
			'href',
			'/new-dataset'
		);
		await expect(menu.getByRole('menuitem', { name: 'New Space' })).toHaveAttribute(
			'href',
			'/new-space'
		);
		await expect(menu.getByRole('menuitem', { name: 'Sign Out' })).toBeVisible();

		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByRole('button', { name: 'Open menu' }).click();
		const nav = page.getByRole('navigation', { name: 'Main' });
		await expect(nav.getByRole('link', { name: 'My repositories' })).toHaveAttribute(
			'href',
			'/settings/repositories'
		);
		await expect(nav.getByRole('link', { name: 'New Space' })).toHaveAttribute(
			'href',
			'/new-space'
		);
		await expect(nav.getByRole('button', { name: 'Sign Out' })).toBeVisible();
	});

	test('my repositories lists the signed-in owner and organizations with settings links', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto('/settings/repositories');
		await expect(page.getByRole('heading', { name: 'My repositories', level: 1 })).toBeVisible();
		await expect(page.getByRole('link', { name: 'New model' })).toHaveAttribute('href', '/new');
		await expect(page.getByRole('link', { name: 'alice/demo', exact: true })).toHaveAttribute(
			'href',
			base
		);
		await expect(page.getByRole('link', { name: 'Settings: alice/demo' })).toHaveAttribute(
			'href',
			`${base}/settings`
		);
		await expect(page.getByRole('link', { name: 'alice/notes', exact: true })).toHaveAttribute(
			'href',
			'/datasets/alice/notes'
		);
		await expect(page.getByRole('link', { name: 'alice/app', exact: true })).toHaveAttribute(
			'href',
			'/spaces/alice/app'
		);
		await page.getByLabel('Owner').selectOption('acme');
		await expect(page.getByRole('link', { name: 'acme/data', exact: true })).toHaveAttribute(
			'href',
			'/datasets/acme/data'
		);
		await expect(page.getByRole('link', { name: 'alice/demo', exact: true })).toHaveCount(0);
		await expect(page.getByText('No Models yet.')).toBeVisible();
		const lists = calls.filter((c) => c.url.pathname === '/api/models');
		expect(lists.map((c) => c.url.searchParams.get('author'))).toEqual(['alice', 'acme']);
		expect(lists.every((c) => c.headers['authorization'] === 'Bearer hf_good')).toBe(true);
		const whoami = calls.findIndex((c) => c.url.pathname === '/api/whoami-v2');
		expect(whoami).toBeGreaterThanOrEqual(0);
		expect(calls.findIndex((c) => c.url.pathname === '/api/models')).toBeGreaterThan(whoami);
	});

	test('a session check that failed before the page opened offers a retry instead of checking forever', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page, { whoami: [503] });
		await signIn(page);
		await page.goto('/');
		const whoami = () => requests(calls, 'GET', '/api/whoami-v2');
		await expect.poll(() => whoami().length).toBe(1);
		await navigate(page, '/settings/repositories');
		await expect(page).toHaveURL('/settings/repositories');
		await expect(page.getByRole('alert')).toContainText('could not be verified');
		await expect(page.getByRole('heading', { name: 'My repositories' })).toHaveCount(0);
		expect(await page.evaluate(() => localStorage.getItem('hfx.token'))).toBe('hf_good');
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect(page.getByRole('heading', { name: 'My repositories', level: 1 })).toBeVisible();
		await expect(page).toHaveURL('/settings/repositories');
		expect(whoami()).toHaveLength(2);
	});

	test('anonymous visitors are sent to login and return to a safe local path only', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await page.goto('/new-dataset');
		await expect(page).toHaveURL('/login?next=%2Fnew-dataset');
		expect(calls.filter((c) => c.url.pathname.startsWith('/api/repos'))).toHaveLength(0);
		await page.getByLabel('Access token').fill('hf_good');
		await page.getByRole('button', { name: 'Log In' }).click();
		await expect(page).toHaveURL('/new-dataset');
		await expect(
			page.getByRole('heading', { name: 'Create a new dataset repository' })
		).toBeVisible();

		await page.goto('/settings/repositories');
		await expect(page.getByRole('heading', { name: 'My repositories' })).toBeVisible();
		await page.evaluate(() => localStorage.removeItem('hfx.token'));
		await page.goto('/settings/repositories');
		await expect(page).toHaveURL('/login?next=%2Fsettings%2Frepositories');

		await page.goto('/login?next=https%3A%2F%2Fevil.example%2Fx');
		await page.getByLabel('Access token').fill('hf_good');
		await page.getByRole('button', { name: 'Log In' }).click();
		await expect(page).toHaveURL('/');
		await page.evaluate(() => localStorage.removeItem('hfx.token'));
		await page.goto('/login?next=%2F%2Fevil.example%2Fx');
		await page.getByLabel('Access token').fill('hf_good');
		await page.getByRole('button', { name: 'Log In' }).click();
		await expect(page).toHaveURL('/');
	});

	test('creates public repositories with the hub body and lands on the repository', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto('/new');
		await expect(
			page.getByRole('heading', { name: 'Create a new model repository', level: 1 })
		).toBeVisible();
		await expect(page.getByLabel('Owner')).toHaveValue('alice');
		await expect(page.getByText('Public repository')).toBeVisible();
		await expect(page.getByLabel('Space SDK')).toHaveCount(0);
		await page.getByLabel('Repository name').fill('my-model');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL('/alice/my-model');
		const [create] = requests(calls, 'POST', '/api/repos/create');
		expect(JSON.parse(create.body)).toEqual({
			type: 'model',
			name: 'my-model',
			organization: 'alice',
			private: false
		});
		expect(create.headers['authorization']).toBe('Bearer hf_good');

		await page.goto('/new-dataset');
		await page.getByLabel('Owner').selectOption('acme');
		await page.getByLabel('Repository name').fill('set');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL('/datasets/acme/set');
		expect(JSON.parse(requests(calls, 'POST', '/api/repos/create')[1].body)).toEqual({
			type: 'dataset',
			name: 'set',
			organization: 'acme',
			private: false
		});

		await page.goto('/new-space');
		await expect(page.getByRole('heading', { name: 'Create a new Space', level: 1 })).toBeVisible();
		await page.getByLabel('Space SDK').selectOption('gradio');
		await page.getByLabel('Repository name').fill('app2');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL('/spaces/alice/app2');
		expect(JSON.parse(requests(calls, 'POST', '/api/repos/create')[2].body)).toEqual({
			type: 'space',
			name: 'app2',
			organization: 'alice',
			private: false,
			sdk: 'gradio'
		});
	});

	test('writes the Space SDK into a README when the hub ignored it, guarded by the initial commit', async ({
		page
	}) => {
		const { calls, spaces } = await mockManagementHub(page);
		await signIn(page);
		await page.goto('/new-space');
		await page.getByLabel('Space SDK').selectOption('docker');
		await page.getByLabel('Repository name').fill('app2');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL('/spaces/alice/app2');
		await expect(page.getByText('docker', { exact: true })).toBeVisible();
		const paths = calls
			.filter(
				(c) => c.url.pathname.includes('alice/app2') || c.url.pathname === '/api/repos/create'
			)
			.map((c) => `${c.method} ${c.url.pathname}`);
		// Existence is checked before create, the README only after it.
		expect(paths.indexOf('GET /api/spaces/alice/app2')).toBeLessThan(
			paths.indexOf('POST /api/repos/create')
		);
		expect(paths.indexOf('POST /api/repos/create')).toBeLessThan(
			paths.indexOf(`GET /spaces/alice/app2/resolve/${SPACE_SHA}/README.md`)
		);
		const [commit] = requests(calls, 'POST', '/api/spaces/alice/app2/commit/main');
		expect(ndjson(commit.body)).toEqual([
			{ key: 'header', value: { summary: 'Create README.md', parentCommit: SPACE_SHA } },
			{
				key: 'file',
				value: {
					path: 'README.md',
					content: Buffer.from('---\ntitle: app2\nsdk: docker\n---\n').toString('base64'),
					encoding: 'base64'
				}
			}
		]);
		expect(spaces['alice/app2'].files['README.md']).toBe('---\ntitle: app2\nsdk: docker\n---\n');
	});

	test('leaves a README the hub wrote itself alone', async ({ page }) => {
		const { calls, spaces } = await mockManagementHub(page, { spaces: 'hf' });
		await signIn(page);
		await page.goto('/new-space');
		await page.getByLabel('Space SDK').selectOption('streamlit');
		await page.getByLabel('Repository name').fill('app2');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL('/spaces/alice/app2');
		await expect(page.getByText('streamlit', { exact: true })).toBeVisible();
		expect(requests(calls, 'POST', '/api/spaces/alice/app2/commit/main')).toHaveLength(0);
		expect(spaces['alice/app2'].files['README.md']).toBe('---\ntitle: app2\nsdk: streamlit\n---\n');
	});

	test('refuses to create a Space over an existing repository and never touches its files', async ({
		page
	}) => {
		const { calls, spaces } = await mockManagementHub(page);
		await signIn(page);
		await page.goto('/new-space');
		await page.getByLabel('Space SDK').selectOption('gradio');
		const name = page.getByLabel('Repository name');
		await name.fill('app');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page.getByRole('alert')).toContainText('alice/app already exists');
		await expect(page).toHaveURL('/new-space');
		await expect(name).toHaveValue('app');
		expect(requests(calls, 'POST', '/api/repos/create')).toHaveLength(0);
		expect(requests(calls, 'POST', '/api/spaces/alice/app/commit/main')).toHaveLength(0);
		expect(spaces['alice/app'].files['README.md']).toBe('---\nsdk: static\n---\n');
	});

	test('reports a Space whose README could not be written and retries only the README', async ({
		page
	}) => {
		const options = { commit: 500 };
		const { calls, spaces } = await mockManagementHub(page, options);
		await signIn(page);
		await page.goto('/new-space');
		await page.getByLabel('Repository name').fill('app2');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page.getByRole('alert')).toContainText('500');
		await expect(page.getByRole('status')).toContainText('alice/app2 was created');
		await expect(page).toHaveURL('/new-space');
		expect(spaces['alice/app2'].files['README.md']).toBeUndefined();
		options.commit = 200;
		await page.getByRole('button', { name: 'Write the README' }).click();
		await expect(page).toHaveURL('/spaces/alice/app2');
		expect(requests(calls, 'POST', '/api/repos/create')).toHaveLength(1);
		const commits = requests(calls, 'POST', '/api/spaces/alice/app2/commit/main');
		expect(commits.map((c) => ndjson(c.body)[0].value.parentCommit)).toEqual([
			SPACE_SHA,
			SPACE_SHA
		]);
		expect(spaces['alice/app2'].files['README.md']).toBe('---\ntitle: app2\nsdk: gradio\n---\n');
	});

	test('keeps the form on local validation errors, conflicts and missing permission', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto('/new');
		const name = page.getByLabel('Repository name');
		const submit = page.getByRole('button', { name: 'Create repository' });
		await name.fill('bad..name');
		await submit.click();
		await expect(page.getByRole('alert')).toContainText('"--" and ".."');
		expect(requests(calls, 'POST', '/api/repos/create')).toHaveLength(0);
		await expect(name).toHaveValue('bad..name');
		await name.fill('taken');
		await submit.click();
		await expect(page.getByRole('alert')).toContainText('already created');
		await expect(page).toHaveURL('/new');
		await expect(name).toHaveValue('taken');
	});

	test('shows the permission error and stays signed in when the hub refuses', async ({ page }) => {
		await mockManagementHub(page);
		await signIn(page, 'hf_limited');
		await page.goto('/new');
		const name = page.getByLabel('Repository name');
		await expect(page.getByLabel('Owner')).toHaveValue('carol');
		await name.fill('nope');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page.getByRole('alert')).toContainText('403');
		await expect(page.getByRole('alert')).toContainText('rights');
		await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
		await expect(name).toHaveValue('nope');
		expect(await page.evaluate(() => localStorage.getItem('hfx.token'))).toBe('hf_limited');
	});

	test('a rejected token is replaced from the write error without signing out first', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page, 'hf_stale');
		await page.goto('/new');
		await expect(page.getByLabel('Owner')).toHaveValue('alice');
		await page.getByLabel('Repository name').fill('my-model');
		await page.getByRole('button', { name: 'Create repository' }).click();
		const alert = page.getByRole('alert');
		await expect(alert).toContainText('401');
		await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
		await alert.getByRole('link', { name: 'Log In' }).click();
		await expect(page).toHaveURL('/login?next=%2Fnew&reauth=1');
		await expect(page.getByText('You are signed in as alice.')).toBeVisible();
		await page.getByLabel('Access token').fill('hf_good');
		await page.getByRole('button', { name: 'Log In' }).click();
		await expect(page).toHaveURL('/new');
		await page.getByLabel('Repository name').fill('my-model');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL('/alice/my-model');
		expect(
			requests(calls, 'POST', '/api/repos/create').map((c) => c.headers['authorization'])
		).toEqual(['Bearer hf_stale', 'Bearer hf_good']);
		expect(await page.evaluate(() => localStorage.getItem('hfx.token'))).toBe('hf_good');
	});

	test('signing out during a pending create discards its late success', async ({ page }) => {
		const { calls, held } = await mockManagementHub(page, { hold: ['create'] });
		await signIn(page);
		await page.goto('/new');
		await page.getByLabel('Repository name').fill('slow');
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect.poll(() => held.length).toBe(1);
		await expect(page.getByRole('button', { name: 'Creating…' })).toBeDisabled();
		await page.getByRole('button', { name: 'Account menu' }).click();
		await page.getByRole('menuitem', { name: 'Sign Out' }).click();
		await expect(page).toHaveURL('/login?next=%2Fnew');
		await held[0].resume().catch(() => undefined);
		await expect(page).toHaveURL('/login?next=%2Fnew');
		expect(requests(calls, 'POST', '/api/repos/create')).toHaveLength(1);
	});

	test('renames a repository after confirmation and reports a conflict', async ({ page }) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(base);
		await page.getByRole('link', { name: 'Settings' }).click();
		await expect(page).toHaveURL(`${base}/settings`);
		const name = page.getByLabel('New name');
		await name.fill('taken');
		await page.getByRole('button', { name: 'Rename repository' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('alice/taken');
		await dialog.getByRole('button', { name: 'Rename' }).click();
		await expect(page.getByRole('alert')).toContainText('already exists');
		await expect(page).toHaveURL(`${base}/settings`);
		await expect(name).toHaveValue('taken');

		await name.fill('renamed');
		await page.getByRole('button', { name: 'Rename repository' }).click();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toBeHidden();
		expect(requests(calls, 'POST', '/api/repos/move')).toHaveLength(1);
		await page.getByRole('button', { name: 'Rename repository' }).click();
		await dialog.getByRole('button', { name: 'Rename' }).click();
		await expect(page).toHaveURL('/alice/renamed');
		expect(JSON.parse(requests(calls, 'POST', '/api/repos/move')[1].body)).toEqual({
			fromRepo: REPO,
			toRepo: 'alice/renamed',
			type: 'model'
		});
	});

	test('keeps a refused rename on the settings page with the hub error', async ({ page }) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page, 'hf_limited');
		await page.goto(`${base}/settings`);
		await page.getByLabel('New name').fill('mine');
		await page.getByRole('button', { name: 'Rename repository' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
		await expect(page.getByRole('alert')).toContainText('403');
		await expect(page.getByRole('alert')).toContainText('rights');
		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(page).toHaveURL(`${base}/settings`);
		await expect(page.getByLabel('New name')).toHaveValue('mine');
		await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
		expect(requests(calls, 'POST', '/api/repos/move')).toHaveLength(1);
	});

	test('deletes a repository only after its full id is typed, never on cancel', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/settings`);
		await page.getByRole('button', { name: 'Delete this repository' }).click();
		const dialog = page.getByRole('dialog');
		const confirm = dialog.getByRole('button', { name: 'Delete repository' });
		const typed = dialog.getByLabel('Type alice/demo to confirm');
		await expect(confirm).toBeDisabled();
		await typed.fill('alice/dem');
		await expect(confirm).toBeDisabled();
		await typed.fill('alice/demo');
		await expect(confirm).toBeEnabled();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toBeHidden();
		await expect(page).toHaveURL(`${base}/settings`);
		expect(requests(calls, 'DELETE', '/api/repos/delete')).toHaveLength(0);

		await page.getByRole('button', { name: 'Delete this repository' }).click();
		await expect(confirm).toBeDisabled();
		await typed.fill('alice/demo');
		await confirm.click();
		await expect(page).toHaveURL('/settings/repositories');
		const [del] = requests(calls, 'DELETE', '/api/repos/delete');
		expect(JSON.parse(del.body)).toEqual({ type: 'model', name: 'demo', organization: 'alice' });
		expect(del.headers['authorization']).toBe('Bearer hf_good');
	});

	test('settings input and confirmation do not carry over to another repository', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/settings`);
		await page.getByLabel('New name').fill('carried');
		await page.getByRole('button', { name: 'Delete this repository' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Type alice/demo to confirm').fill('alice/demo');
		await expect(dialog.getByRole('button', { name: 'Delete repository' })).toBeEnabled();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await navigate(page, `/${SECOND}/settings`);
		await expect(page).toHaveURL(`/${SECOND}/settings`);
		await expect(page.getByText(`This permanently deletes ${SECOND}`).first()).toBeVisible();
		await expect(page.getByLabel('New name')).toHaveValue('');
		await page.getByRole('button', { name: 'Delete this repository' }).click();
		await expect(dialog.getByRole('button', { name: 'Delete repository' })).toBeDisabled();
		await expect(dialog.getByLabel(`Type ${SECOND} to confirm`)).toHaveValue('');
		expect(requests(calls, 'DELETE', '/api/repos/delete')).toHaveLength(0);
	});

	test('hides the settings tab from anonymous visitors and sends them to login', async ({
		page
	}) => {
		await mockManagementHub(page);
		await page.goto(base);
		await expect(page.getByRole('link', { name: 'Model card' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
		await page.goto(`${base}/settings`);
		await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`${base}/settings`)}`);
	});

	test('management pages fit desktop and mobile without horizontal overflow', async ({ page }) => {
		await mockManagementHub(page);
		await signIn(page);
		mkdirSync('test-results/management', { recursive: true });
		const pages = [
			['new', '/new', 'Repository name'],
			['new-space', '/new-space', 'Space SDK'],
			['my-repos', '/settings/repositories', 'Owner'],
			['settings', `${base}/settings`, 'New name']
		] as const;
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 900 });
			for (const [name, url, label] of pages) {
				await page.goto(url);
				await expect(page.getByLabel(label)).toBeVisible();
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth
				);
				expect(overflow, `${url} at ${width}`).toBeLessThanOrEqual(0);
				await page.screenshot({
					path: `test-results/management/${name}-${width}.png`,
					fullPage: true
				});
			}
		}
	});
});
