import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, readme, test, unique } from '../fixtures/selfhosted.ts';

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

test.describe('selfhosted hub', () => {
	test('serves the embedded page and assets byte-for-byte, with JSON misses under /api', async ({
		hub
	}) => {
		const index = readFileSync('build/app/index.html');
		for (const path of ['/', '/models', `/${hub.owner}/nope/tree/main`, '/settings/repositories']) {
			const res = await hub.request.get(path);
			expect(res.status(), path).toBe(200);
			expect(res.headers()['content-type']).toContain('text/html');
			expect(Buffer.from(await res.body()).equals(index), `${path} is the built index`).toBe(true);
		}
		const miss = await hub.request.get('/api/nope');
		expect(miss.status()).toBe(404);
		expect(await miss.json()).toEqual({ error: 'Not Found' });
		expect((await hub.request.get(`/api/models/${hub.owner}/nope`)).status()).toBe(404);

		const dir = 'build/app/_app/immutable/entry';
		const [file] = readdirSync(dir).filter((f) => f.endsWith('.js'));
		const bytes = readFileSync(join(dir, file));
		const asset = await hub.request.get(`/_app/immutable/entry/${file}`);
		expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
		expect(asset.headers()['content-type']).toContain('javascript');
		expect(sha256(new Uint8Array(await asset.body()))).toBe(sha256(bytes));
		const range = await hub.request.get(`/_app/immutable/entry/${file}`, {
			headers: { Range: 'bytes=10-19' }
		});
		expect(range.status()).toBe(206);
		expect(Buffer.from(await range.body()).equals(bytes.subarray(10, 20))).toBe(true);
		const logo = await hub.request.get(
			`/_app/immutable/assets/${readdirSync('build/app/_app/immutable/assets').find((f) => /^logo\..*\.svg$/.test(f))}`
		);
		expect(logo.headers()['content-type']).toContain('image/svg+xml');
		expect(await logo.text()).toContain('<svg');
	});

	test('lists, searches and filters seeded repositories with hub projections and history', async ({
		hub
	}) => {
		const suffix = unique('q');
		const model = await hub.create('model', `list-${suffix}`);
		const sha0 = await hub.tip('model', model);
		const sha1 = await hub.commit(
			'model',
			model,
			'main',
			[{ path: 'README.md', content: readme('dot.png') }],
			sha0
		);
		await hub.commit(
			'model',
			model,
			'main',
			[{ path: 'docs/guide/intro.txt', content: 'intro\n' }],
			sha1
		);
		const dataset = await hub.create('dataset', `data-${suffix}`);
		await hub.commit(
			'dataset',
			dataset,
			'main',
			[
				{
					path: 'README.md',
					content:
						'---\ntask_categories:\n  - text-classification\nlanguage:\n  - en\n---\n# Data\n'
				}
			],
			await hub.tip('dataset', dataset)
		);

		const ids = (items: { id: string }[]) => items.map((i) => i.id);
		const models = await hub.json<
			{ id: string; author?: string; lastModified?: string; pipeline_tag?: string }[]
		>(
			`/api/models?author=${hub.owner}&search=${suffix}&expand[]=author&expand[]=lastModified&expand[]=pipeline_tag&sort=lastModified&direction=-1&limit=5`
		);
		expect(models).toEqual([
			expect.objectContaining({ id: model, author: hub.owner, pipeline_tag: 'text-generation' })
		]);
		expect(models[0].lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(
			ids(await hub.json(`/api/models?pipeline_tag=text-generation&search=${suffix}`))
		).toEqual([model]);
		expect(ids(await hub.json(`/api/models?pipeline_tag=fill-mask&search=${suffix}`))).toEqual([]);
		expect(
			ids(
				await hub.json(`/api/models?filter=selfhosted-fixture&filter=license:mit&search=${suffix}`)
			)
		).toEqual([model]);
		expect(
			ids(
				await hub.json(`/api/datasets?filter=task_categories:text-classification&search=${suffix}`)
			)
		).toEqual([dataset]);
		expect(ids(await hub.json(`/api/datasets?filter=language:fr&search=${suffix}`))).toEqual([]);
		expect(ids(await hub.json(`/api/models?search=data-${suffix}`))).toEqual([]);
		const tags = await hub.json<Record<string, { id: string }[]>>('/api/models-tags-by-type');
		expect(tags.pipeline_tag.map((t) => t.id)).toContain('text-generation');
		const quick = await hub.json<{ models: { id: string }[]; datasets: { id: string }[] }>(
			`/api/quicksearch?q=${suffix}&type=all`
		);
		expect(ids(quick.models)).toEqual([model]);
		expect(ids(quick.datasets)).toEqual([dataset]);

		const commits = await hub.request.get(`/api/models/${model}/commits/main?limit=1`);
		expect(commits.headers()['x-total-count']).toBe('3');
		expect(await commits.json()).toHaveLength(1);
		const paths = { paths: ['docs/guide/intro.txt', 'docs', 'missing.txt'], expand: true };
		const asJson = await hub.request.post(`/api/models/${model}/paths-info/main`, { data: paths });
		const asForm = await hub.request.post(`/api/models/${model}/paths-info/main`, {
			form: { paths: 'docs/guide/intro.txt', expand: 'true' }
		});
		expect(asJson.status()).toBe(200);
		expect(asForm.status()).toBe(200);
		expect(await asJson.json()).toEqual([
			expect.objectContaining({
				type: 'file',
				path: 'docs/guide/intro.txt',
				size: 6,
				lastCommit: expect.any(Object)
			}),
			expect.objectContaining({ type: 'directory', path: 'docs' })
		]);
		expect(await asForm.json()).toEqual([
			expect.objectContaining({ path: 'docs/guide/intro.txt' })
		]);
		const refs = await hub.json<{
			branches: { name: string; targetCommit: string }[];
			tags: unknown[];
		}>(`/api/models/${model}/refs`);
		expect(refs.branches).toEqual([
			{ name: 'main', ref: 'refs/heads/main', targetCommit: await hub.tip('model', model) }
		]);
		const head = await hub.request.head(`/${model}/resolve/main/README.md`);
		expect(head.headers()['x-repo-commit']).toBe(refs.branches[0].targetCommit);
		expect(head.headers()['etag']).toMatch(/^"[0-9a-f]{40}"$/);
	});

	test('git clone over HTTP returns the seeded bytes', async ({ hub, baseURL }) => {
		const id = await hub.create('model', unique('clone'));
		const config = JSON.stringify({ hidden_size: 8 });
		await hub.commit(
			'model',
			id,
			'main',
			[
				{ path: 'README.md', content: '# Clone me\n' },
				{ path: 'config.json', content: config }
			],
			await hub.tip('model', id)
		);
		const dir = test.info().outputPath('clone');
		mkdirSync(dir, { recursive: true });
		execFileSync('git', ['clone', '--quiet', `${baseURL}/${id}.git`, '.'], {
			cwd: dir,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' }
		});
		expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('# Clone me\n');
		expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe(config);
		expect(readFileSync(join(dir, '.gitattributes'), 'utf8')).toContain('*.safetensors filter=lfs');
		const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
		expect(head).toBe(await hub.tip('model', id));
	});
});
