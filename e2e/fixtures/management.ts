// Write-capable hub fixture for the management pages: create/delete/move, whoami with orgs,
// and the SDK commit protocol (preupload → LFS batch → PUT → ndjson commit) with a parent guard.
import type { Page, Request, Route } from '@playwright/test';

export const OWNER = 'alice';
export const REPO = 'alice/demo';
// Answers info and refs only, for navigation between repositories.
export const SECOND = 'alice/second';
export const MAIN_SHA = '607a30d783dfa663caf39e06633721c8d4cfcd7e';
export const BRANCH_SHA = '11c5a3d5811f50298f278a704980280950aedb10';
export const NEW_SHA = 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed';
// Tip written by "someone else" through advance().
export const OTHER_SHA = 'ca11ab1eca11ab1eca11ab1eca11ab1eca11ab1e';
// Initial commit of a Space created through the fixture, and its tip after one more commit.
export const SPACE_SHA = 'ace00001ace00001ace00001ace00001ace00001';
export const SPACE_NEXT_SHA = 'ace00002ace00002ace00002ace00002ace00002';
export const README = '# Demo\n\nHello from the fixture.\n';
// Files at or above this size take the LFS path in the fixture.
export const LFS_FROM = 10 * 1024;

export interface Recorded {
	method: string;
	url: URL;
	headers: Record<string, string>;
	body: string;
}

export interface ManagementOptions {
	// Status for the commit endpoint; 412 rejects the parent commit.
	commit?: number;
	// Status for POST /api/repos/create.
	create?: number;
	// Statuses for successive whoami calls; later calls behave normally.
	whoami?: number[];
	// How create initializes a Space: hfd ignores the sdk and writes .gitattributes only,
	// the real hub also writes a README carrying the sdk. Both answer 200 for an existing repo.
	spaces?: 'hfd' | 'hf';
	// Requests to park until the test releases them.
	hold?: ('preupload' | 'commit' | 'create' | 'move' | 'delete')[];
}

const users: Record<string, { name: string; orgs: string[]; canWrite: boolean; stale?: boolean }> =
	{
		hf_good: { name: OWNER, orgs: ['acme'], canWrite: true },
		hf_limited: { name: 'carol', orgs: [], canWrite: false },
		// Still answers whoami, but every write is refused with 401 as for a revoked token.
		hf_stale: { name: OWNER, orgs: [], canWrite: true, stale: true }
	};

const listed = (id: string, extra: Record<string, unknown> = {}) => ({
	_id: id,
	id,
	private: false,
	likes: 3,
	downloads: 42,
	lastModified: '2026-09-10T00:00:00.000Z',
	...extra
});

const ref = (name: string, kind: 'heads' | 'tags', targetCommit: string) => ({
	name,
	ref: `refs/${kind}/${name}`,
	targetCommit
});

let oidSeed = 0;
const entry = (type: 'file' | 'directory', path: string, size = 8) => ({
	type,
	oid: (++oidSeed).toString(16).padStart(40, 'b'),
	...(type === 'file' ? { size } : {}),
	path,
	lastCommit: { id: MAIN_SHA, title: 'Fixture: initial commit', date: '2026-09-01T00:00:00.000Z' }
});

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
	status,
	contentType: 'application/json',
	headers,
	body: JSON.stringify(body)
});

export interface Held {
	route: Route;
	// Runs the reply the fixture would have sent immediately.
	resume: () => Promise<void>;
}

export async function mockManagementHub(page: Page, options: ManagementOptions = {}) {
	const calls: Recorded[] = [];
	const held: Held[] = [];
	const whoamiStatuses = [...(options.whoami ?? [])];
	const spaces: Record<string, { sha: string; sdk?: string; files: Record<string, string> }> = {
		'alice/app': {
			sha: SPACE_SHA,
			sdk: 'static',
			files: { 'README.md': '---\nsdk: static\n---\n' }
		}
	};
	const tips: Record<string, string> = { main: MAIN_SHA, 'feat/branch': BRANCH_SHA };
	const texts: Record<string, string> = {
		'main:README.md': README,
		'main:docs/usage.md': '# Usage\n',
		'feat/branch:README.md': '# Demo (branch)\n',
		'v1.0:README.md': README
	};
	const trees: Record<string, ReturnType<typeof entry>[]> = {
		'main:': [
			entry('file', '.gitattributes', 1519),
			entry('file', 'README.md', README.length),
			entry('directory', 'docs'),
			entry('file', 'weights.bin', 4 * 1024 * 1024)
		],
		'main:docs': [entry('file', 'docs/usage.md', 8)],
		'feat/branch:': [entry('file', 'README.md', 16)],
		'v1.0:': [entry('file', 'README.md', README.length)]
	};
	const refs = {
		branches: [ref('main', 'heads', MAIN_SHA), ref('feat/branch', 'heads', BRANCH_SHA)],
		tags: [ref('v1.0', 'tags', MAIN_SHA)],
		converts: []
	};
	// Files of tips that moved on, so a read at an old sha stays immutable.
	const history: Record<string, Record<string, string>> = {};
	const filesOf = (branch: string) =>
		Object.fromEntries(
			Object.entries(texts)
				.filter(([key]) => key.startsWith(`${branch}:`))
				.map(([key, text]) => [key.slice(branch.length + 1), text])
		);
	const advance = (branch: string, sha: string, changes: Record<string, string | null>) => {
		history[tips[branch]] = filesOf(branch);
		tips[branch] = sha;
		for (const [path, text] of Object.entries(changes)) {
			if (text === null) delete texts[`${branch}:${path}`];
			else texts[`${branch}:${path}`] = text;
		}
	};
	const branchOf = (rev: string) => Object.keys(tips).find((b) => tips[b] === rev) ?? rev;
	const knownSha = (rev: string) => Object.values(tips).includes(rev) || rev in history;
	const record = (request: Request) => {
		const recorded = {
			method: request.method(),
			url: new URL(request.url()),
			headers: request.headers(),
			body: request.postData() ?? ''
		};
		calls.push(recorded);
		return recorded;
	};
	const userOf = (headers: Record<string, string>, write = false) => {
		const user = users[(headers['authorization'] ?? '').replace(/^Bearer /, '')];
		return write && user?.stale ? undefined : user;
	};
	const forbidden = (route: Route) =>
		route.fulfill(json({ error: 'You do not have the rights to write to this repository.' }, 403));
	const unauthorized = (route: Route) =>
		route.fulfill(json({ error: 'Invalid credentials in Authorization header' }, 401));
	const park = (
		route: Route,
		what: NonNullable<ManagementOptions['hold']>[number],
		reply: () => Promise<void>
	) => {
		if (!options.hold?.includes(what)) return reply();
		held.push({ route, resume: reply });
	};

	await page.route('**/api/**', async (route) => {
		const { method, url, headers, body } = record(route.request());
		const segments = url.pathname.split('/').slice(1).map(decodeURIComponent);
		const user = userOf(headers);
		const writer = userOf(headers, true);
		if (url.pathname === '/api/whoami-v2') {
			const forced = whoamiStatuses.shift();
			if (forced && forced !== 200) {
				return route.fulfill(json({ error: 'Fixture hub unavailable' }, forced));
			}
			if (!user) return unauthorized(route);
			return route.fulfill(
				json({
					type: 'user',
					name: user.name,
					fullname: user.name[0].toUpperCase() + user.name.slice(1),
					orgs: user.orgs.map((name) => ({ name, fullname: name.toUpperCase(), type: 'org' })),
					auth: { type: 'access_token', accessToken: { displayName: 'fixture', role: 'write' } }
				})
			);
		}
		if (url.pathname.startsWith('/api/repos/')) {
			if (!writer) return unauthorized(route);
			if (!writer.canWrite) return forbidden(route);
			const payload = JSON.parse(body || '{}');
			if (url.pathname === '/api/repos/create' && method === 'POST') {
				if (options.create && options.create !== 200) {
					return route.fulfill(
						json({ error: `Fixture refused to create ${payload.name}` }, options.create)
					);
				}
				if (payload.name === 'taken') {
					return route.fulfill(json({ error: 'You already created this model repo' }, 409));
				}
				const spaceId = `${payload.organization}/${payload.name}`;
				if (payload.type === 'space' && !spaces[spaceId]) {
					spaces[spaceId] =
						options.spaces === 'hf'
							? {
									sha: SPACE_SHA,
									sdk: payload.sdk,
									files: {
										'.gitattributes': '',
										'README.md': `---\ntitle: ${payload.name}\nsdk: ${payload.sdk}\n---\n`
									}
								}
							: { sha: SPACE_SHA, files: { '.gitattributes': '' } };
				}
				return park(route, 'create', () =>
					route.fulfill(
						json({ url: `${url.origin}/${payload.organization}/${payload.name}`, id: payload.name })
					)
				);
			}
			if (url.pathname === '/api/repos/delete' && method === 'DELETE') {
				return park(route, 'delete', () => route.fulfill({ status: 200, body: '' }));
			}
			if (url.pathname === '/api/repos/move' && method === 'POST') {
				if (payload.toRepo === 'alice/taken') {
					return route.fulfill(
						json({ error: 'destination repository "alice/taken" already exists' }, 409)
					);
				}
				return park(route, 'move', () => route.fulfill({ status: 200, body: '' }));
			}
			return route.fulfill(json({ error: 'not mocked' }, 404));
		}
		if (['models', 'datasets', 'spaces'].includes(segments[1]) && segments.length === 2) {
			const author = url.searchParams.get('author');
			const byType: Record<string, unknown[]> = {
				models: author === OWNER ? [listed(REPO, { pipeline_tag: 'text-generation' })] : [],
				datasets:
					author === OWNER
						? [listed('alice/notes')]
						: author === 'acme'
							? [listed('acme/data')]
							: [],
				spaces: author === OWNER ? [listed('alice/app', { sdk: 'static' })] : []
			};
			return route.fulfill(json(byType[segments[1]]));
		}
		if (segments[1] === 'spaces') {
			const space = spaces[`${segments[2]}/${segments[3]}`];
			const [, , owner, name, kind, ...rest] = segments;
			if (!space) return route.fulfill(json({ error: 'Repository not found' }, 404));
			const readmeSdk = /sdk: (\w+)/.exec(space.files['README.md'] ?? '')?.[1];
			const spaceInfo = {
				_id: `space-${name}`,
				id: `${owner}/${name}`,
				author: owner,
				private: false,
				gated: false,
				sha: space.sha,
				lastModified: '2026-09-10T00:00:00.000Z',
				likes: 0,
				tags: [],
				siblings: Object.keys(space.files).map((rfilename) => ({ rfilename })),
				createdAt: '2026-09-10T00:00:00.000Z',
				// hfd only surfaces the README front matter as cardData; the real hub sets sdk itself.
				...(space.sdk ? { sdk: space.sdk } : readmeSdk ? { cardData: { sdk: readmeSdk } } : {})
			};
			if (kind === undefined || (kind === 'revision' && rest[0] === 'main')) {
				return route.fulfill(json(spaceInfo));
			}
			if (kind === 'refs') {
				return route.fulfill(
					json({ branches: [ref('main', 'heads', space.sha)], tags: [], converts: [] })
				);
			}
			if (kind === 'tree') {
				return route.fulfill(
					json(
						Object.entries(space.files).map(([path, text]) => ({
							...entry('file', path, text.length),
							lastCommit: {
								id: space.sha,
								title: 'Fixture: space',
								date: '2026-09-10T00:00:00.000Z'
							}
						}))
					)
				);
			}
			if ((kind === 'preupload' || kind === 'commit') && method === 'POST') {
				if (!writer) return unauthorized(route);
				if (!writer.canWrite) return forbidden(route);
			}
			if (kind === 'preupload' && method === 'POST') {
				const { files } = JSON.parse(body) as { files: { path: string }[] };
				return route.fulfill(
					json({ files: files.map((f) => ({ path: f.path, uploadMode: 'regular' })) })
				);
			}
			if (kind === 'commit' && method === 'POST') {
				if (options.commit && options.commit !== 200) {
					return route.fulfill(json({ error: 'Fixture refused the commit' }, options.commit));
				}
				const lines = ndjson(body);
				if (lines[0]?.value?.parentCommit !== space.sha || rest[0] !== 'main') {
					return route.fulfill(json({ error: 'Parent commit does not match the branch tip' }, 412));
				}
				for (const line of lines) {
					if (line.key === 'file') {
						space.files[line.value.path] = Buffer.from(line.value.content, 'base64').toString();
					}
				}
				space.sha = SPACE_NEXT_SHA;
				return route.fulfill(
					json({
						commitUrl: `${url.origin}/spaces/${owner}/${name}/commit/${SPACE_NEXT_SHA}`,
						commitOid: SPACE_NEXT_SHA,
						hookOutput: ''
					})
				);
			}
			return route.fulfill(json({ error: 'not mocked' }, 404));
		}
		const id = `${segments[2]}/${segments[3]}`;
		if (segments[1] !== 'models' || (id !== REPO && id !== SECOND)) {
			return route.fulfill(json({ error: 'Repository not found' }, 404));
		}
		const [, , , , kind, ...rest] = segments;
		const info = (rev = 'main') => ({
			_id: '621ffdc036468d709f17434d',
			id,
			author: OWNER,
			private: false,
			gated: false,
			sha: tips[rev] ?? (knownSha(rev) ? rev : MAIN_SHA),
			lastModified: '2026-09-10T00:00:00.000Z',
			likes: 3,
			downloads: 42,
			tags: ['license:mit'],
			siblings: trees['main:'].filter((e) => e.type === 'file').map((e) => ({ rfilename: e.path })),
			createdAt: '2026-09-01T00:00:00.000Z'
		});
		if (kind === undefined) return route.fulfill(json(info()));
		if (kind === 'refs') return route.fulfill(json(refs));
		if (id === SECOND) return route.fulfill(json({ error: 'not mocked' }, 404));
		if (kind === 'revision') {
			const rev = rest[0];
			if (!(rev in tips) && rev !== 'v1.0' && !knownSha(rev)) {
				return route.fulfill(json({ error: `Revision "${rev}" not found` }, 404));
			}
			return route.fulfill(json(info(rev)));
		}
		if (kind === 'tree') {
			const [rev, ...path] = rest;
			const items = trees[`${rev}:${path.join('/')}`];
			if (!items) return route.fulfill(json({ error: 'Entry not found' }, 404));
			return route.fulfill(
				json(
					items.map((e) => ({
						...e,
						lastCommit: { ...e.lastCommit, id: tips[rev] ?? e.lastCommit.id }
					}))
				)
			);
		}
		if (kind === 'commits') {
			return route.fulfill(
				json(
					[
						{
							id: tips[rest[0]] ?? MAIN_SHA,
							title: 'Fixture: initial commit',
							message: 'Fixture: initial commit',
							authors: [{ user: OWNER }],
							date: '2026-09-01T00:00:00.000Z'
						}
					],
					200,
					{ 'x-total-count': '1' }
				)
			);
		}
		if (kind === 'preupload' && method === 'POST') {
			if (!writer) return unauthorized(route);
			if (!writer.canWrite) return forbidden(route);
			const { files } = JSON.parse(body) as { files: { path: string; size: number }[] };
			return park(route, 'preupload', () =>
				route.fulfill(
					json({
						files: files.map((f) => ({
							path: f.path,
							uploadMode: f.size >= LFS_FROM ? 'lfs' : 'regular'
						}))
					})
				)
			);
		}
		if (kind === 'commit' && method === 'POST') {
			if (!writer) return unauthorized(route);
			if (!writer.canWrite) return forbidden(route);
			return park(route, 'commit', async () => {
				if (options.commit && options.commit !== 200) {
					return route.fulfill(
						json(
							{ error: 'A commit has happened since. Please refresh and try again.' },
							options.commit
						)
					);
				}
				const branch = rest[0];
				const lines = body.split('\n').map((line) => JSON.parse(line));
				const header = lines.find((l) => l.key === 'header')?.value ?? {};
				if (header.parentCommit !== tips[branch]) {
					return route.fulfill(json({ error: 'Parent commit does not match the branch tip' }, 412));
				}
				const changes: Record<string, string | null> = {};
				for (const line of lines) {
					if (line.key === 'file') {
						changes[line.value.path] = Buffer.from(line.value.content, 'base64').toString();
					}
					if (line.key === 'deletedFile') changes[line.value.path] = null;
				}
				advance(branch, NEW_SHA, changes);
				return route.fulfill(
					json({
						commitUrl: `${url.origin}/${REPO}/commit/${NEW_SHA}`,
						commitOid: NEW_SHA,
						hookOutput: ''
					})
				);
			});
		}
		return route.fulfill(json({ error: 'not mocked' }, 404));
	});

	await page.route('**/*.git/info/lfs/objects/batch', async (route) => {
		const { url, body, headers } = record(route.request());
		if (!userOf(headers, true)) return unauthorized(route);
		const { objects } = JSON.parse(body) as { objects: { oid: string; size: number }[] };
		return route.fulfill({
			status: 200,
			contentType: 'application/vnd.git-lfs+json',
			body: JSON.stringify({
				transfer: 'basic',
				objects: objects.map((o) => ({
					oid: o.oid,
					size: o.size,
					actions: { upload: { href: `${url.origin}/lfs-upload/${o.oid}` } }
				}))
			})
		});
	});

	await page.route('**/lfs-upload/**', async (route) => {
		record(route.request());
		// The SDK's XHR wrapper needs at least one response header to build its Response.
		return route.fulfill({
			status: 200,
			contentType: 'text/plain',
			headers: { etag: '"fixture"' },
			body: ''
		});
	});

	await page.route('**/resolve/**', async (route) => {
		const { url } = record(route.request());
		const segments = url.pathname.split('/').slice(1).map(decodeURIComponent);
		const serve = (text: string | undefined) =>
			text === undefined
				? route.fulfill(json({ error: 'Entry not found' }, 404))
				: route.fulfill({
						status: 200,
						contentType: 'text/markdown; charset=utf-8',
						headers: { 'content-length': String(Buffer.byteLength(text)) },
						body: text
					});
		if (segments[0] === 'spaces') {
			const [, owner, name, , rev, ...path] = segments;
			const space = spaces[`${owner}/${name}`];
			const current = !!space && (rev === 'main' || rev === space.sha);
			return serve(current ? space.files[path.join('/')] : undefined);
		}
		const [owner, name, , rev, ...path] = segments;
		const file = path.join('/');
		const text = history[rev]?.[file] ?? texts[`${branchOf(rev)}:${file}`];
		return serve(`${owner}/${name}` === REPO ? text : undefined);
	});

	return { calls, held, tips, texts, spaces, advance };
}

export const requests = (calls: Recorded[], method: string, path: string) =>
	calls.filter((c) => c.method === method && c.url.pathname === path);

export const ndjson = (body: string) => body.split('\n').map((line) => JSON.parse(line));

// Same-app navigation through the router, so the route component is reused instead of reloaded.
export async function navigate(page: Page, href: string) {
	await page.evaluate((h) => {
		const a = document.createElement('a');
		a.href = h;
		a.id = 'e2e-navigate';
		a.textContent = 'navigate';
		document.body.append(a);
	}, href);
	await page.locator('#e2e-navigate').click();
	await page.evaluate(() => document.getElementById('e2e-navigate')?.remove());
}
