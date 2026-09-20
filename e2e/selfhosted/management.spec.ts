import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { tinySafetensors } from '../../src/lib/files/testing.ts';
import {
	expect,
	overflow,
	png,
	readme,
	signIn,
	test,
	unique,
	type Hub
} from '../fixtures/selfhosted.ts';

test.use({ timezoneId: 'UTC', locale: 'en-US' });

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

// Every request the browser sends to the hub, as "METHOD /path", to assert the SDK protocol.
function record(page: Page, origin: string) {
	const calls: string[] = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.origin === origin) calls.push(`${request.method()} ${url.pathname}`);
	});
	return calls;
}

function git(cwd: string, ...args: string[]) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' }
	});
}

// Intrinsic width and top-left pixel of a same-origin image, decoded in the page and read through a canvas.
const pixel = (page: Page, src: string) =>
	page.evaluate(async (src) => {
		const img = new Image();
		img.src = src;
		await img.decode();
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(img, 0, 0, 1, 1);
		return { width: img.naturalWidth, rgba: Array.from(ctx.getImageData(0, 0, 1, 1).data) };
	}, src);

async function seedReadme(hub: Hub, prefix: string, content = '# Demo\n') {
	const id = await hub.create('model', unique(prefix));
	const sha = await hub.commit(
		'model',
		id,
		'main',
		[{ path: 'README.md', content }],
		await hub.tip('model', id)
	);
	return { id, sha };
}

test.describe('selfhosted management', () => {
	test('signs in, creates a model and uploads regular, nested and LFS files through the SDK', async ({
		page,
		hub,
		token,
		baseURL
	}) => {
		const name = unique('model');
		const id = `${hub.owner}/${name}`;
		const calls = record(page, baseURL!);
		await page.goto('/new');
		await expect(page).toHaveURL('/login?next=%2Fnew');
		await page.getByLabel('Access token').fill(token);
		await page.getByRole('button', { name: 'Log In' }).click();
		await expect(page).toHaveURL('/new');
		await expect(page.getByLabel('Owner')).toHaveValue(hub.owner);
		await page.getByLabel('Repository name').fill(name);
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL(`/${id}`);

		await page.getByRole('link', { name: 'Files and versions' }).click();
		await expect(page).toHaveURL(`/${id}/tree/main`);
		await page.getByRole('button', { name: 'Add file' }).click();
		await page.getByRole('menuitem', { name: 'Upload files' }).click();
		await expect(page).toHaveURL(`/${id}/upload/main`);
		const weights = tinySafetensors();
		// Above the SDK's 10 MB in-memory hashing cutoff, so the browser hashes it with the bundled WebAssembly sha256.
		const big = Buffer.alloc(11 * 1024 * 1024);
		for (let i = 0; i < big.length; i += 4) big.writeUInt32LE((i * 2654435761) >>> 0, i);
		const config = JSON.stringify({ architectures: ['FixtureModel'], hidden_size: 8 }, null, 2);
		await page.getByLabel('Select files').setInputFiles([
			{
				name: 'README.md',
				mimeType: 'text/markdown',
				buffer: Buffer.from(readme('docs/guide/dot.png'))
			},
			{ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(config) },
			{
				name: 'tiny.safetensors',
				mimeType: 'application/octet-stream',
				buffer: Buffer.from(weights)
			},
			{ name: 'big.bin', mimeType: 'application/octet-stream', buffer: big }
		]);
		await page.getByRole('button', { name: 'Upload files' }).click();
		await expect(page).toHaveURL(`/${id}/tree/main`);
		const files = page.getByRole('table', { name: 'Files' });
		await expect(files).toContainText('tiny.safetensors');

		await page.goto(`/${id}/upload/main`);
		await page.getByLabel('Folder').fill('docs/guide');
		await page.getByLabel('Select files').setInputFiles([
			{ name: 'intro.txt', mimeType: 'text/plain', buffer: Buffer.from('Welcome to the guide.\n') },
			{ name: 'dot.png', mimeType: 'image/png', buffer: png(16, 16, [200, 30, 30]) }
		]);
		await page.getByRole('button', { name: 'Upload files' }).click();
		await expect(page).toHaveURL(`/${id}/tree/main/docs/guide`);
		await expect(files.getByRole('link', { name: 'intro.txt', exact: true })).toBeVisible();

		// The SDK protocol against the real hub: preupload, one LFS batch + PUT per LFS file, ndjson commits.
		const oid = sha256(weights);
		const bigOid = sha256(big);
		expect(calls).toContain(`POST /api/models/${id}/preupload/main`);
		expect(calls).toContain(`POST /${id}.git/info/lfs/objects/batch`);
		expect(calls).toContain(`PUT /objects/${oid}`);
		expect(calls).toContain(`PUT /objects/${bigOid}`);
		expect(calls.filter((c) => c === `POST /api/models/${id}/commit/main`)).toHaveLength(2);
		expect(calls.filter((c) => c.startsWith('PUT '))).toHaveLength(2);
		const tree = await hub.json<
			{ path: string; type: string; lfs?: { oid: string; size: number } }[]
		>(`/api/models/${id}/tree/main?recursive=true`);
		expect(tree.map((e) => `${e.type}:${e.path}`)).toEqual([
			'file:.gitattributes',
			'file:README.md',
			'file:big.bin',
			'file:config.json',
			'directory:docs',
			'directory:docs/guide',
			'file:docs/guide/dot.png',
			'file:docs/guide/intro.txt',
			'file:tiny.safetensors'
		]);
		expect(tree.find((e) => e.path === 'big.bin')?.lfs).toMatchObject({
			oid: bigOid,
			size: big.length
		});
		const bigHead = await hub.request.head(`/${id}/resolve/main/big.bin`);
		expect(bigHead.headers()['x-linked-etag']).toBe(`"${bigOid}"`);
		expect(bigHead.headers()['x-linked-size']).toBe(String(big.length));
		const tail = await hub.request.get(`/${id}/resolve/main/big.bin`, {
			headers: { Range: 'bytes=-16' }
		});
		expect(tail.status()).toBe(206);
		expect(Buffer.from(await tail.body()).equals(big.subarray(big.length - 16))).toBe(true);
		expect(tree.find((e) => e.path === 'tiny.safetensors')?.lfs).toEqual({
			oid,
			size: weights.byteLength,
			pointerSize: expect.any(Number)
		});
		const head = await hub.request.head(`/${id}/resolve/main/tiny.safetensors`);
		expect(head.status()).toBe(200);
		expect(head.headers()['x-linked-etag']).toBe(`"${oid}"`);
		expect(head.headers()['x-linked-size']).toBe(String(weights.byteLength));
		const download = await hub.request.get(`/${id}/resolve/main/tiny.safetensors`);
		expect(sha256(new Uint8Array(await download.body()))).toBe(oid);
		const range = await hub.request.get(`/${id}/resolve/main/tiny.safetensors`, {
			headers: { Range: 'bytes=0-7' }
		});
		expect(range.status()).toBe(206);
		expect(Buffer.from(await range.body()).equals(Buffer.from(weights.subarray(0, 8)))).toBe(true);
		expect(await hub.text('model', id, 'main', 'docs/guide/intro.txt')).toBe(
			'Welcome to the guide.\n'
		);

		// Folder navigation from the root, then the viewers: code, markdown with math and image, tensors.
		await page.goto(`/${id}/tree/main`);
		const commits = await hub.request.get(`/api/models/${id}/commits/main?limit=1`);
		expect(commits.headers()['x-total-count']).toBe('3');
		await expect(page.getByText('History: 3 commits')).toBeVisible();
		await files.getByRole('link', { name: 'docs', exact: true }).click();
		await expect(page).toHaveURL(`/${id}/tree/main/docs`);
		await files.getByRole('link', { name: 'guide', exact: true }).click();
		await expect(page).toHaveURL(`/${id}/tree/main/docs/guide`);
		await files.getByRole('link', { name: 'dot.png', exact: true }).click();
		await expect(page).toHaveURL(`/${id}/blob/main/docs/guide/dot.png`);
		const image = page.getByRole('img', { name: 'dot.png' });
		await expect(image).toBeVisible();
		expect(
			await pixel(page, await image.evaluate((img: HTMLImageElement) => img.currentSrc))
		).toEqual({
			width: 16,
			rgba: [200, 30, 30, 255]
		});
		await page.goto(`/${id}/blob/main/config.json`);
		await expect(page.getByText('FixtureModel')).toBeVisible();
		await page.goto(`/${id}`);
		await expect(page.getByRole('heading', { name: 'Fixture model' })).toBeVisible();
		await expect(page.locator('.katex').first()).toBeVisible();
		await expect(page.locator('pre code').first()).toContainText('def greet');
		const inline = page.getByRole('img', { name: 'dot' });
		await expect(inline).toHaveAttribute('src', `/${id}/resolve/main/docs/guide/dot.png`);
		expect(
			(await pixel(page, await inline.evaluate((img: HTMLImageElement) => img.currentSrc))).width
		).toBe(16);
		await page.goto(`/${id}/blob/main/tiny.safetensors`);
		await expect(page.getByText('model.embed.weight')).toBeVisible();
	});

	test('edits against the loaded tip, keeps the text when the branch moved and commits after a confirmed reload', async ({
		page,
		hub,
		token
	}) => {
		const { id, sha } = await seedReadme(hub, 'edit');
		await signIn(page, token);
		await page.goto(`/${id}/edit/main/README.md`);
		const editor = page.getByLabel('File content');
		await expect(editor).toHaveValue('# Demo\n');
		await hub.commit(
			'model',
			id,
			'main',
			[{ path: 'README.md', content: '# Demo\n\nSomeone else.\n' }],
			sha
		);
		await editor.fill('# Demo\n\nMine.\n');
		await page.getByLabel('Commit message').fill('Mine');
		const [refused] = await Promise.all([
			page.waitForResponse(
				(r) => r.request().method() === 'POST' && r.url().endsWith(`/api/models/${id}/commit/main`)
			),
			page.getByRole('button', { name: 'Commit changes' }).click()
		]);
		expect(refused.status()).toBe(412);
		const alert = page.getByRole('alert');
		await expect(alert).toContainText('The branch moved since this page was loaded (412');
		await expect(editor).toHaveValue('# Demo\n\nMine.\n');
		expect(await hub.text('model', id, 'main', 'README.md')).toBe('# Demo\n\nSomeone else.\n');

		page.once('dialog', (dialog) => void dialog.dismiss());
		await page.getByRole('button', { name: 'Reload file' }).click();
		await expect(editor).toHaveValue('# Demo\n\nMine.\n');
		page.once('dialog', (dialog) => void dialog.accept());
		await page.getByRole('button', { name: 'Reload file' }).click();
		await expect(editor).toHaveValue('# Demo\n\nSomeone else.\n');
		await expect(alert).toHaveCount(0);
		await editor.fill('# Demo\n\nSomeone else.\n\nMine too.\n');
		await page.getByRole('button', { name: 'Commit changes' }).click();
		await expect(page).toHaveURL(`/${id}/blob/main/README.md`);
		await expect(page.getByText('Mine too.')).toBeVisible();
		expect(await hub.text('model', id, 'main', 'README.md')).toBe(
			'# Demo\n\nSomeone else.\n\nMine too.\n'
		);
		const commits = await hub.request.get(`/api/models/${id}/commits/main?limit=1`);
		expect(commits.headers()['x-total-count']).toBe('4');
	});

	test('deletes a file after its path is typed, then renames and deletes the repository from Settings', async ({
		page,
		hub,
		token
	}) => {
		const name = unique('manage');
		const id = await hub.create('model', name);
		await hub.commit(
			'model',
			id,
			'main',
			[
				{ path: 'README.md', content: '# Manage\n' },
				{ path: 'config.json', content: '{}' }
			],
			await hub.tip('model', id)
		);
		await signIn(page, token);
		await page.goto(`/${id}/blob/main/config.json`);
		await page.getByRole('link', { name: 'Delete file' }).click();
		await expect(page).toHaveURL(`/${id}/delete/main/config.json`);
		const remove = page.getByRole('button', { name: 'Delete file' });
		await expect(remove).toBeDisabled();
		await page.getByLabel('Type the file path to confirm').fill('config.json');
		await remove.click();
		await expect(page).toHaveURL(`/${id}/tree/main`);
		const files = page.getByRole('table', { name: 'Files' });
		await expect(files.getByRole('link', { name: 'README.md', exact: true })).toBeVisible();
		await expect(files.getByRole('link', { name: 'config.json', exact: true })).toHaveCount(0);
		expect((await hub.request.get(`/${id}/resolve/main/config.json`)).status()).toBe(404);

		const renamed = `${hub.owner}/${name}-renamed`;
		await page.getByRole('link', { name: 'Settings' }).click();
		await expect(page).toHaveURL(`/${id}/settings`);
		await page.getByLabel('New name').fill(`${name}-renamed`);
		await page.getByRole('button', { name: 'Rename repository' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText(renamed);
		await dialog.getByRole('button', { name: 'Rename' }).click();
		await expect(page).toHaveURL(`/${renamed}`);
		await expect(page.getByRole('heading', { name: 'Manage', exact: true })).toBeVisible();
		expect((await hub.request.get(`/api/models/${id}`)).status()).toBe(404);
		expect(await hub.text('model', renamed, 'main', 'README.md')).toBe('# Manage\n');

		await page.getByRole('link', { name: 'Settings' }).click();
		await page.getByRole('button', { name: 'Delete this repository' }).click();
		const confirm = dialog.getByRole('button', { name: 'Delete repository' });
		await expect(confirm).toBeDisabled();
		await dialog.getByLabel(`Type ${renamed} to confirm`).fill(renamed);
		await confirm.click();
		await expect(page).toHaveURL('/settings/repositories');
		await expect(page.getByRole('heading', { name: 'My repositories', level: 1 })).toBeVisible();
		await expect(page.getByRole('link', { name: renamed, exact: true })).toHaveCount(0);
		expect((await hub.request.get(`/api/models/${renamed}`)).status()).toBe(404);
	});

	test('creates a dataset and a Space in their own namespaces; the Space README carries the chosen SDK', async ({
		page,
		hub,
		token
	}) => {
		await signIn(page, token);
		const dataset = unique('set');
		await page.goto('/new-dataset');
		await page.getByLabel('Repository name').fill(dataset);
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL(`/datasets/${hub.owner}/${dataset}`);
		expect((await hub.request.get(`/api/datasets/${hub.owner}/${dataset}`)).status()).toBe(200);
		expect((await hub.request.get(`/api/models/${hub.owner}/${dataset}`)).status()).toBe(404);

		const space = unique('app');
		await page.goto('/new-space');
		await page.getByLabel('Space SDK').selectOption('static');
		await page.getByLabel('Repository name').fill(space);
		await page.getByRole('button', { name: 'Create repository' }).click();
		await expect(page).toHaveURL(`/spaces/${hub.owner}/${space}`);
		const info = await hub.json<{ cardData?: { sdk?: string }; siblings: { rfilename: string }[] }>(
			`/api/spaces/${hub.owner}/${space}`
		);
		expect(info.cardData?.sdk).toBe('static');
		expect(await hub.text('space', `${hub.owner}/${space}`, 'main', 'README.md')).toContain(
			'sdk: static'
		);

		await page.goto('/settings/repositories');
		await expect(
			page.getByRole('link', { name: `${hub.owner}/${dataset}`, exact: true })
		).toHaveAttribute('href', `/datasets/${hub.owner}/${dataset}`);
		await expect(
			page.getByRole('link', { name: `${hub.owner}/${space}`, exact: true })
		).toHaveAttribute('href', `/spaces/${hub.owner}/${space}`);
	});

	test('a slash branch pushed over git is browsable and is never edited as another branch', async ({
		page,
		hub,
		token,
		baseURL
	}) => {
		const { id, sha } = await seedReadme(hub, 'slash', '# Main\n');
		const clone = test.info().outputPath('clone');
		mkdirSync(clone, { recursive: true });
		git(clone, 'clone', '--quiet', `${baseURL}/${id}.git`, '.');
		expect(git(clone, 'show', 'HEAD:README.md')).toBe('# Main\n');
		writeFileSync(join(clone, 'README.md'), '# Branch\n');
		git(
			clone,
			'-c',
			'user.name=fixture',
			'-c',
			'user.email=fixture@example.com',
			'commit',
			'--quiet',
			'--all',
			'--message',
			'branch readme'
		);
		expect(() => git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/feat/branch')).toThrow(
			/403/
		);
		git(
			clone,
			'-c',
			`http.extraHeader=Authorization: Bearer ${token}`,
			'push',
			'--quiet',
			'origin',
			'HEAD:refs/heads/feat/branch'
		);
		const refs = await hub.json<{ branches: { name: string; targetCommit: string }[] }>(
			`/api/models/${id}/refs`
		);
		expect(refs.branches.map((b) => b.name).sort()).toEqual(['feat/branch', 'main']);
		expect(refs.branches.find((b) => b.name === 'main')?.targetCommit).toBe(sha);

		await signIn(page, token);
		await page.goto(`/${id}/tree/feat%2Fbranch`);
		await expect(page.getByRole('table', { name: 'Files' })).toContainText('README.md');
		await page.goto(`/${id}/blob/feat%2Fbranch/README.md`);
		await expect(page.getByRole('heading', { name: 'Branch' })).toBeVisible();
		// hfd addresses revisions as one path segment, so editing on feat/branch is refused; it must never open main's file instead.
		await page.goto(`/${id}/edit/feat%2Fbranch/README.md`);
		const editor = page.getByLabel('File content');
		await expect(page.getByRole('alert').or(editor)).toBeVisible();
		if (await editor.count()) await expect(editor).toHaveValue('# Branch\n');
		expect(await hub.tip('model', id)).toBe(sha);
		expect(await hub.text('model', id, 'feat/branch', 'README.md')).toBe('# Branch\n');
	});

	test('anonymous visitors read everything and the hub refuses their writes without effect', async ({
		page,
		hub
	}) => {
		const { id, sha } = await seedReadme(hub, 'public');
		await page.goto(`/${id}/tree/main`);
		await expect(page.getByRole('table', { name: 'Files' })).toContainText('README.md');
		await expect(page.getByRole('button', { name: 'Add file' })).toHaveCount(0);
		await page.goto(`/${id}/blob/main/README.md`);
		await expect(page.getByRole('heading', { name: 'Demo' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Edit file' })).toHaveCount(0);
		await page.goto(`/${id}/edit/main/README.md`);
		await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/${id}/edit/main/README.md`)}`);
		const refused = await hub.request.post(`/api/models/${id}/commit/main`, {
			headers: { 'Content-Type': 'application/x-ndjson' },
			data:
				JSON.stringify({ key: 'header', value: { summary: 'anon', parentCommit: sha } }) +
				'\n' +
				JSON.stringify({
					key: 'file',
					value: { path: 'README.md', content: '# Anon\n', encoding: 'utf-8' }
				}) +
				'\n'
		});
		expect(refused.status()).toBe(403);
		expect(await hub.tip('model', id)).toBe(sha);
		expect(await hub.text('model', id, 'main', 'README.md')).toBe('# Demo\n');
	});

	test('repository, settings and editor pages fit 1440 and 390 without horizontal overflow', async ({
		page,
		hub,
		token
	}) => {
		const id = await hub.create('model', unique('layout'));
		await hub.commit(
			'model',
			id,
			'main',
			[
				{ path: 'README.md', content: readme('docs/guide/dot.png') },
				{ path: 'docs/guide/dot.png', content: png(16, 16, [30, 30, 200]) },
				{ path: 'docs/guide/intro.txt', content: 'intro\n' }
			],
			await hub.tip('model', id)
		);
		await signIn(page, token);
		mkdirSync('test-results/selfhosted', { recursive: true });
		const pages = [
			['repo', `/${id}`, page.getByRole('heading', { name: 'Fixture model' })],
			['tree', `/${id}/tree/main/docs/guide`, page.getByRole('table', { name: 'Files' })],
			['settings', `/${id}/settings`, page.getByLabel('New name')],
			['editor', `/${id}/edit/main/README.md`, page.getByLabel('File content')]
		] as const;
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 900 });
			for (const [name, url, ready] of pages) {
				await page.goto(url);
				await expect(ready).toBeVisible();
				const logo = page.locator('header img').first();
				await expect(logo).toHaveJSProperty('complete', true);
				expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
				expect(await overflow(page), `${url} at ${width}`).toBeLessThanOrEqual(0);
				await page.screenshot({
					path: `test-results/selfhosted/${name}-${width}.png`,
					fullPage: true
				});
			}
		}
	});
});
