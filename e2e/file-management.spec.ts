import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
	BRANCH_SHA,
	MAIN_SHA,
	mockManagementHub,
	navigate,
	ndjson,
	NEW_SHA,
	OTHER_SHA,
	README,
	REPO,
	requests
} from './fixtures/management.ts';

test.use({ timezoneId: 'UTC', locale: 'en-US' });

const base = `/${REPO}`;
const signIn = (page: Page, token = 'hf_good') =>
	page.addInitScript((value) => localStorage.setItem('hfx.token', value), token);
const b64 = (text: string) => Buffer.from(text).toString('base64');

test.describe('file management', () => {
	test('uploads files through the SDK protocol with true phases and lands on the branch tree', async ({
		page
	}) => {
		const { calls, held } = await mockManagementHub(page, { hold: ['commit'] });
		await signIn(page);
		await page.goto(`${base}/tree/main`);
		await page.getByRole('button', { name: 'Add file' }).click();
		await expect(page.getByRole('menuitem', { name: 'Create a new file' })).toHaveAttribute(
			'href',
			`${base}/new/main`
		);
		await page.getByRole('menuitem', { name: 'Upload files' }).click();
		await expect(page).toHaveURL(`${base}/upload/main`);
		await expect(page.getByLabel('Branch')).toHaveValue('main');
		const big = Buffer.alloc(20 * 1024, 7);
		const input = page.getByLabel('Select files');
		await input.setInputFiles([
			{ name: 'small.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
			{ name: 'big.bin', mimeType: 'application/octet-stream', buffer: big }
		]);
		const list = page.getByRole('list', { name: 'Selected files' });
		await expect(list.getByRole('listitem')).toHaveCount(2);
		await list.getByRole('button', { name: 'Remove small.txt' }).click();
		await expect(list.getByRole('listitem')).toHaveCount(1);
		await input.setInputFiles([
			{ name: 'small.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }
		]);
		await expect(list.getByRole('listitem')).toHaveCount(2);
		await expect(page.getByLabel('Commit message')).toHaveAttribute(
			'placeholder',
			'Upload 2 files'
		);
		await page.getByLabel('Folder').fill('data');
		await page.getByRole('button', { name: 'Upload files' }).click();
		await expect.poll(() => held.length).toBe(1);
		await expect(page.getByRole('status')).toContainText('Committing');
		await expect(page.getByRole('button', { name: 'Upload files' })).toBeDisabled();
		await held[0].resume();
		await expect(page).toHaveURL(`${base}/tree/main/data`);

		const [pre] = requests(calls, 'POST', `/api/models/${REPO}/preupload/main`);
		expect(
			JSON.parse(pre.body)
				.files.map((f: { path: string }) => f.path)
				.sort()
		).toEqual(['data/big.bin', 'data/small.txt']);
		expect(pre.headers['authorization']).toBe('Bearer hf_good');
		const [batch] = requests(calls, 'POST', `/${REPO}.git/info/lfs/objects/batch`);
		expect(JSON.parse(batch.body)).toMatchObject({
			operation: 'upload',
			transfers: ['basic', 'multipart'],
			hash_algo: 'sha_256',
			ref: { name: 'main' }
		});
		expect(
			calls.filter((c) => c.method === 'PUT' && c.url.pathname.startsWith('/lfs-upload/'))
		).toHaveLength(1);
		const [commit] = requests(calls, 'POST', `/api/models/${REPO}/commit/main`);
		expect(commit.headers['authorization']).toBe('Bearer hf_good');
		expect(commit.headers['content-type']).toContain('application/x-ndjson');
		const lines = ndjson(commit.body);
		expect(lines[0]).toEqual({
			key: 'header',
			value: { summary: 'Upload 2 files', parentCommit: MAIN_SHA }
		});
		expect(lines.find((l) => l.key === 'lfsFile').value).toMatchObject({
			path: 'data/big.bin',
			algo: 'sha256',
			size: big.length
		});
		expect(lines.find((l) => l.key === 'file').value).toEqual({
			path: 'data/small.txt',
			content: b64('hello'),
			encoding: 'base64'
		});
	});

	test('cancels an upload and keeps the selection', async ({ page }) => {
		const { calls, held } = await mockManagementHub(page, { hold: ['preupload'] });
		await signIn(page);
		await page.goto(`${base}/upload/feat%2Fbranch`);
		await expect(page.getByLabel('Branch')).toHaveValue('feat/branch');
		await page
			.getByLabel('Select files')
			.setInputFiles([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') }]);
		await page.getByRole('button', { name: 'Upload files' }).click();
		await expect.poll(() => held.length).toBe(1);
		await expect(page.getByRole('status')).toContainText('Preparing');
		await page.getByRole('button', { name: 'Cancel upload' }).click();
		await expect(page.getByRole('status')).toContainText('cancelled');
		await expect(page.getByRole('button', { name: 'Upload files' })).toBeEnabled();
		await expect(
			page.getByRole('list', { name: 'Selected files' }).getByRole('listitem')
		).toHaveCount(1);
		await expect(page).toHaveURL(`${base}/upload/feat%2Fbranch`);
		await held[0].resume().catch(() => undefined);
		expect(requests(calls, 'POST', `/api/models/${REPO}/commit/feat%2Fbranch`)).toHaveLength(0);
	});

	test('a pending upload is dropped when the route moves to another branch', async ({ page }) => {
		const { calls, held } = await mockManagementHub(page, { hold: ['commit'] });
		await signIn(page);
		await page.goto(`${base}/upload/main`);
		await page
			.getByLabel('Select files')
			.setInputFiles([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') }]);
		await page.getByRole('button', { name: 'Upload files' }).click();
		await expect.poll(() => held.length).toBe(1);
		await expect(page.getByRole('status')).toContainText('Committing');
		await navigate(page, `${base}/upload/feat%2Fbranch`);
		await expect(page).toHaveURL(`${base}/upload/feat%2Fbranch`);
		await expect(page.getByLabel('Branch')).toHaveValue('feat/branch');
		await expect(page.getByText('No files selected yet.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Upload files' })).toHaveAttribute(
			'aria-busy',
			'false'
		);
		await held[0].resume().catch(() => undefined);
		await expect(page).toHaveURL(`${base}/upload/feat%2Fbranch`);
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect(page.getByRole('status')).toHaveCount(0);
		expect(requests(calls, 'POST', `/api/models/${REPO}/commit/main`)).toHaveLength(1);
	});

	test('edits a text file against the loaded branch tip and warns before leaving unsaved changes', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/blob/main/README.md`);
		const edit = page.getByRole('link', { name: 'Edit file' });
		await expect(edit).toHaveAttribute('href', `${base}/edit/main/README.md`);
		await expect(page.getByRole('link', { name: 'Delete file' })).toHaveAttribute(
			'href',
			`${base}/delete/main/README.md`
		);
		await edit.click();
		const editor = page.getByLabel('File content');
		await expect(editor).toHaveValue(README);
		await editor.fill('# Demo\n\nEdited.\n');
		await page.getByRole('tab', { name: 'Preview' }).click();
		await expect(page.getByRole('heading', { name: 'Demo', exact: true })).toBeVisible();
		await page.getByRole('tab', { name: 'Edit' }).click();

		const dialogs: string[] = [];
		page.on('dialog', (dialog) => {
			dialogs.push(dialog.message());
			void dialog.dismiss();
		});
		await page.getByRole('link', { name: 'Model card' }).click();
		await expect.poll(() => dialogs.length).toBe(1);
		await expect(page).toHaveURL(`${base}/edit/main/README.md`);
		await expect(editor).toHaveValue('# Demo\n\nEdited.\n');

		await page.getByLabel('Commit message').fill('Edit readme');
		await page.getByRole('button', { name: 'Commit changes' }).click();
		await expect(page).toHaveURL(`${base}/blob/main/README.md`);
		await expect(page.getByText('Edited.')).toBeVisible();
		expect(dialogs).toHaveLength(1);
		const [commit] = requests(calls, 'POST', `/api/models/${REPO}/commit/main`);
		expect(ndjson(commit.body)).toEqual([
			{ key: 'header', value: { summary: 'Edit readme', parentCommit: MAIN_SHA } },
			{
				key: 'file',
				value: { path: 'README.md', content: b64('# Demo\n\nEdited.\n'), encoding: 'base64' }
			}
		]);
	});

	test('reports a moved branch tip without losing the edited text', async ({ page }) => {
		const { calls } = await mockManagementHub(page, { commit: 412 });
		await signIn(page);
		await page.goto(`${base}/edit/feat%2Fbranch/README.md`);
		const editor = page.getByLabel('File content');
		await expect(editor).toHaveValue('# Demo (branch)\n');
		await editor.fill('changed');
		await page.getByRole('button', { name: 'Commit changes' }).click();
		await expect(page.getByRole('alert')).toContainText('412');
		await expect(page.getByRole('alert')).toContainText('A commit has happened since');
		await expect(editor).toHaveValue('changed');
		await expect(page).toHaveURL(`${base}/edit/feat%2Fbranch/README.md`);
		const tips = () => requests(calls, 'GET', `/api/models/${REPO}/revision/feat%2Fbranch`);
		expect(tips()).toHaveLength(1);
		// Declining the reload keeps the text and the parent it was loaded against.
		const dialogs: string[] = [];
		page.once('dialog', (dialog) => {
			dialogs.push(dialog.message());
			void dialog.dismiss();
		});
		await page.getByRole('button', { name: 'Reload file' }).click();
		await expect.poll(() => dialogs.length).toBe(1);
		await expect(editor).toHaveValue('changed');
		expect(tips()).toHaveLength(1);
		page.once('dialog', (dialog) => void dialog.accept());
		await page.getByRole('button', { name: 'Reload file' }).click();
		await expect(editor).toHaveValue('# Demo (branch)\n');
		expect(tips()).toHaveLength(2);
	});

	test('never overwrites a concurrent commit: the parent stays tied to the loaded text until a confirmed reload', async ({
		page
	}) => {
		const { calls, texts, advance } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/edit/main/README.md`);
		const editor = page.getByLabel('File content');
		await expect(editor).toHaveValue(README);
		// The text is read at the tip commit, not at the moving branch name.
		expect(
			calls.filter((c) => c.url.pathname === `/${REPO}/resolve/${MAIN_SHA}/README.md`)
		).toHaveLength(1);
		expect(calls.filter((c) => c.url.pathname === `/${REPO}/resolve/main/README.md`)).toHaveLength(
			0
		);
		advance('main', OTHER_SHA, { 'README.md': '# Demo\n\nSomeone else.\n' });
		await editor.fill('# Demo\n\nMine.\n');
		await page.getByRole('button', { name: 'Commit changes' }).click();
		await expect(page.getByRole('alert')).toContainText('412');
		await expect(editor).toHaveValue('# Demo\n\nMine.\n');

		page.once('dialog', (dialog) => void dialog.dismiss());
		await page.getByRole('button', { name: 'Reload file' }).click();
		await expect(editor).toHaveValue('# Demo\n\nMine.\n');
		await page.getByRole('button', { name: 'Commit changes' }).click();
		await expect(page.getByRole('alert')).toContainText('412');
		expect(texts['main:README.md']).toBe('# Demo\n\nSomeone else.\n');

		page.once('dialog', (dialog) => void dialog.accept());
		await page.getByRole('button', { name: 'Reload file' }).click();
		await expect(editor).toHaveValue('# Demo\n\nSomeone else.\n');
		await expect(page.getByRole('alert')).toHaveCount(0);
		await editor.fill('# Demo\n\nSomeone else.\n\nMine too.\n');
		await page.getByRole('button', { name: 'Commit changes' }).click();
		await expect(page).toHaveURL(`${base}/blob/main/README.md`);
		const parents = requests(calls, 'POST', `/api/models/${REPO}/commit/main`).map(
			(c) => ndjson(c.body)[0].value.parentCommit
		);
		expect(parents).toEqual([MAIN_SHA, MAIN_SHA, OTHER_SHA]);
		expect(texts['main:README.md']).toBe('# Demo\n\nSomeone else.\n\nMine too.\n');
	});

	test('a successful commit refreshes the repository info and refs and shows the new tip', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/edit/main/README.md`);
		const editor = page.getByLabel('File content');
		await expect(editor).toHaveValue(README);
		const infos = () => requests(calls, 'GET', `/api/models/${REPO}`);
		const refs = () => requests(calls, 'GET', `/api/models/${REPO}/refs`);
		expect(infos()).toHaveLength(1);
		expect(refs()).toHaveLength(1);
		await editor.fill('# Demo\n\nRefreshed.\n');
		await page.getByLabel('Commit message').fill('Refresh');
		// Typing never refetches the tip the text was loaded against.
		expect(requests(calls, 'GET', `/api/models/${REPO}/revision/main`)).toHaveLength(1);
		await page.getByRole('button', { name: 'Commit changes' }).click();
		await expect(page).toHaveURL(`${base}/blob/main/README.md`);
		await expect(page.getByText('Refreshed.')).toBeVisible();
		await expect(page.getByRole('link', { name: NEW_SHA.slice(0, 7) })).toHaveAttribute(
			'href',
			`${base}/commit/${NEW_SHA}`
		);
		expect(infos()).toHaveLength(2);
		expect(refs()).toHaveLength(2);
	});

	test('refuses to edit at a tag and offers the branches', async ({ page }) => {
		await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/edit/v1.0/README.md`);
		await expect(page.getByRole('alert')).toContainText('branch');
		await expect(page.getByLabel('File content')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'feat/branch' })).toHaveAttribute(
			'href',
			`${base}/edit/feat%2Fbranch/README.md`
		);
		await page.getByRole('link', { name: 'main', exact: true }).click();
		await expect(page.getByLabel('File content')).toHaveValue(README);
	});

	test('creates a new text file under a folder', async ({ page }) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/tree/main/docs`);
		await page.getByRole('button', { name: 'Add file' }).click();
		await page.getByRole('menuitem', { name: 'Create a new file' }).click();
		await expect(page).toHaveURL(`${base}/new/main/docs`);
		const name = page.getByLabel('File name');
		await expect(page.getByText('docs/', { exact: true })).toBeVisible();
		await name.fill('../x');
		await page.getByLabel('File content').fill('notes');
		await page.getByRole('button', { name: 'Commit new file' }).click();
		await expect(page.getByRole('alert')).toContainText('valid');
		expect(requests(calls, 'POST', `/api/models/${REPO}/commit/main`)).toHaveLength(0);
		await name.fill('notes.md');
		await expect(page.getByLabel('Commit message')).toHaveAttribute(
			'placeholder',
			'Create docs/notes.md'
		);
		await page.getByRole('button', { name: 'Commit new file' }).click();
		await expect(page).toHaveURL(`${base}/blob/main/docs/notes.md`);
		const [commit] = requests(calls, 'POST', `/api/models/${REPO}/commit/main`);
		expect(ndjson(commit.body)).toEqual([
			{ key: 'header', value: { summary: 'Create docs/notes.md', parentCommit: MAIN_SHA } },
			{ key: 'file', value: { path: 'docs/notes.md', content: b64('notes'), encoding: 'base64' } }
		]);
	});

	test('deletes a file only after the path is typed', async ({ page }) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/delete/main/docs/usage.md`);
		await expect(page.getByText('docs/usage.md', { exact: true })).toBeVisible();
		const submit = page.getByRole('button', { name: 'Delete file' });
		await expect(submit).toBeDisabled();
		await page.getByLabel('Type the file path to confirm').fill('docs/usage');
		await expect(submit).toBeDisabled();
		await page.getByLabel('Type the file path to confirm').fill('docs/usage.md');
		await expect(submit).toBeEnabled();
		await submit.click();
		await expect(page).toHaveURL(`${base}/tree/main/docs`);
		const [commit] = requests(calls, 'POST', `/api/models/${REPO}/commit/main`);
		expect(ndjson(commit.body)).toEqual([
			{ key: 'header', value: { summary: 'Delete docs/usage.md', parentCommit: MAIN_SHA } },
			{ key: 'deletedFile', value: { path: 'docs/usage.md' } }
		]);
	});

	test('a typed delete confirmation does not carry over to the same file on another branch', async ({
		page
	}) => {
		const { calls } = await mockManagementHub(page);
		await signIn(page);
		await page.goto(`${base}/delete/main/README.md`);
		const submit = page.getByRole('button', { name: 'Delete file' });
		const typed = page.getByLabel('Type the file path to confirm');
		await typed.fill('README.md');
		await expect(submit).toBeEnabled();
		await navigate(page, `${base}/delete/feat%2Fbranch/README.md`);
		await expect(page).toHaveURL(`${base}/delete/feat%2Fbranch/README.md`);
		await expect(typed).toHaveValue('');
		await expect(submit).toBeDisabled();
		await typed.fill('README.md');
		await submit.click();
		await expect(page).toHaveURL(`${base}/tree/feat%2Fbranch`);
		const [commit] = requests(calls, 'POST', `/api/models/${REPO}/commit/feat%2Fbranch`);
		expect(ndjson(commit.body)[0]).toEqual({
			key: 'header',
			value: { summary: 'Delete README.md', parentCommit: BRANCH_SHA }
		});
		expect(requests(calls, 'POST', `/api/models/${REPO}/commit/main`)).toHaveLength(0);
	});

	test('hides file controls from anonymous visitors', async ({ page }) => {
		await mockManagementHub(page);
		await page.goto(`${base}/blob/main/README.md`);
		await expect(page.getByRole('heading', { name: 'Demo', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Edit file' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Delete file' })).toHaveCount(0);
		await page.goto(`${base}/tree/main`);
		await expect(page.getByRole('table', { name: 'Files' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Add file' })).toHaveCount(0);
		await page.goto(`${base}/edit/main/README.md`);
		await expect(page).toHaveURL(
			`/login?next=${encodeURIComponent(`${base}/edit/main/README.md`)}`
		);
	});

	test('signing out aborts a pending write', async ({ page }) => {
		const { calls, held } = await mockManagementHub(page, { hold: ['commit'] });
		await signIn(page);
		await page.goto(`${base}/edit/main/README.md`);
		const editor = page.getByLabel('File content');
		await expect(editor).toHaveValue(README);
		await editor.fill('pending');
		await page.getByRole('button', { name: 'Commit changes' }).click();
		await expect.poll(() => held.length).toBe(1);
		await expect(page.getByRole('button', { name: 'Commit changes' })).toBeDisabled();
		await page.getByRole('button', { name: 'Account menu' }).click();
		await page.getByRole('menuitem', { name: 'Sign Out' }).click();
		await expect(page).toHaveURL(
			`/login?next=${encodeURIComponent(`${base}/edit/main/README.md`)}`
		);
		await held[0].resume().catch(() => undefined);
		await expect(page).toHaveURL(
			`/login?next=${encodeURIComponent(`${base}/edit/main/README.md`)}`
		);
		expect(
			calls.filter((c) => c.url.pathname === `/${REPO}/resolve/${MAIN_SHA}/README.md`)
		).toHaveLength(1);
	});

	test('file pages fit desktop and mobile without horizontal overflow', async ({ page }) => {
		await mockManagementHub(page);
		await signIn(page);
		mkdirSync('test-results/file-management', { recursive: true });
		const pages = [
			['edit', `${base}/edit/main/README.md`, 'File content'],
			['upload', `${base}/upload/main`, 'Select files']
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
					path: `test-results/file-management/${name}-${width}.png`,
					fullPage: true
				});
			}
		}
	});
});
