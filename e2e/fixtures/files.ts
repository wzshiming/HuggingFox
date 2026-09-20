// Hub API + resolve fixtures for the files/history pages, shaped like huggingface.co responses.
import type { Page, Route } from '@playwright/test';
import { rangeReply, tinyGguf, tinySafetensors } from '../../src/lib/files/testing.ts';

export const REPO = 'openai-community/gpt2';
export const SHA = '607a30d783dfa663caf39e06633721c8d4cfcd7e';
export const BRANCH_SHA = '11c5a3d5811f50298f278a704980280950aedb10';
export const ROOT_SHA = 'e7da7f221d5bf496a48136c0cd264e630fe9fcc8';
export const BIG_SHA = 'f5f7b7be3f4e2f6d5b9cd0a7f4f5d1a7d8b0f2c3';
export const EMPTY_SHA = 'a0c8f4d3e2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7';

const day = (n: number, hour = 10) =>
	new Date(Date.UTC(2024, 1, 19 - n, hour, 57, 45)).toISOString();

// Hub shape: branches/tags carry their short name, convert refs only the last segment.
const ref = (name: string, kind: 'heads' | 'tags' | 'convert', targetCommit: string) => ({
	name,
	ref: `refs/${kind}/${name}`,
	targetCommit
});

export const refs = {
	branches: [ref('main', 'heads', SHA), ref('feat/branch', 'heads', BRANCH_SHA)],
	tags: [ref('v1.0', 'tags', SHA)],
	converts: [ref('parquet', 'convert', SHA)]
};

interface EntryOptions {
	size?: number;
	lfs?: boolean;
	xet?: boolean;
	commit?: [string, string, string];
}

let oidSeed = 0;
const entry = (
	type: 'file' | 'directory',
	path: string,
	{ size, lfs, xet, commit }: EntryOptions = {}
) => ({
	type,
	oid: (++oidSeed).toString(16).padStart(40, 'a'),
	...(type === 'file' && size !== undefined ? { size } : {}),
	...(lfs && size !== undefined ? { lfs: { oid: 'c'.repeat(64), size, pointerSize: 134 } } : {}),
	...(xet ? { xetHash: 'd'.repeat(64) } : {}),
	path,
	...(commit ? { lastCommit: { id: commit[0], title: commit[1], date: commit[2] } } : {}),
	...(type === 'file'
		? {
				securityFileStatus: {
					status: 'safe',
					avScan: { status: 'safe' },
					pickleImportScan: { status: 'unscanned' }
				}
			}
		: {})
});

const initial: [string, string, string] = [ROOT_SHA, 'Fixture: initial commit', day(700)];
const latest: [string, string, string] = [SHA, 'Fixture: adding safetensors variant (#1)', day(0)];

export const trees: Record<string, Record<string, unknown>[]> = {
	'main:': [
		entry('file', '.gitattributes', { size: 1519, commit: initial }),
		entry('file', 'README.md', { size: 8, commit: initial }),
		entry('directory', 'assets', { commit: initial }),
		entry('file', 'big.txt', { size: 3 * 1024 * 1024, commit: initial }),
		entry('file', 'blob.dat', { size: 12, commit: initial }),
		entry('file', 'config.json', {
			size: 665,
			commit: [SHA, 'Fixture: update config.json', day(1)]
		}),
		entry('directory', 'docs', { commit: initial }),
		entry('directory', 'feat', { commit: initial }),
		entry('file', 'logo.png', { size: 68, commit: initial }),
		entry('file', 'model.safetensors', { size: 548105171, lfs: true, xet: true, commit: latest }),
		entry('file', 'mystery.xyz', { size: 24, commit: initial }),
		entry('file', 'private.txt', { size: 6, commit: initial }),
		entry('file', 'tiny.gguf', { size: 4096, lfs: true, commit: latest }),
		entry('file', 'weights.bin', { size: 4194304, lfs: true, commit: initial })
	],
	'main:page2': [
		entry('file', 'merges.txt', { size: 456318, commit: initial }),
		entry('file', 'vocab.json', { size: 1042301, commit: initial })
	],
	'main:assets': [entry('file', 'assets/plot.png', { size: 68, commit: initial })],
	'main:docs': [entry('file', 'docs/usage.md', { size: 40, commit: initial })],
	'main:feat': [
		entry('directory', 'feat/branch', { commit: initial }),
		entry('file', 'feat/note.txt', { size: 5, commit: initial })
	],
	'main:feat/branch': [entry('file', 'feat/branch/deep.txt', { size: 5, commit: initial })],
	'feat/branch:': [
		entry('file', 'README.md', { size: 8, commit: initial }),
		entry('file', 'only-on-branch.txt', {
			size: 6,
			commit: [BRANCH_SHA, 'Fixture: branch work', day(2)]
		})
	],
	'v1.0:': [entry('file', 'README.md', { size: 8, commit: initial })],
	'refs/convert/parquet:': [entry('directory', 'default', { commit: initial })],
	'refs/convert/parquet:default': [
		entry('file', 'default/train-00000-of-00001.parquet', {
			size: 2048,
			lfs: true,
			commit: initial
		})
	],
	[`${SHA}:`]: [entry('file', 'README.md', { size: 8, commit: initial })]
};

export const commits = Array.from({ length: 25 }, (_, i) => ({
	id:
		i === 0
			? SHA
			: i === 24
				? ROOT_SHA
				: i === 1
					? EMPTY_SHA
					: i === 2
						? BIG_SHA
						: (i + 1).toString(16).padStart(40, '0'),
	title:
		i === 0
			? 'Fixture: adding safetensors variant (#1)'
			: i === 24
				? 'Fixture: initial commit'
				: `Fixture: commit number ${25 - i}`,
	message:
		i === 0
			? 'Fixture: adding safetensors variant (#1)\n\n- 9be7f7f8f3b2f5c6 <script>alert(1)</script>\n\nCo-authored-by: bot <bot@example>'
			: `Fixture: commit number ${25 - i}`,
	authors:
		i % 3 === 0
			? [
					{ user: 'julien-c', avatar: 'https://cdn-avatars.example/julien.jpeg' },
					{ user: 'lysandre' }
				]
			: [{ user: 'sgugger' }],
	date: day(Math.floor(i / 10) * 3, 20 - (i % 10))
}));

const branchCommits = [
	{
		id: BRANCH_SHA,
		title: 'Fixture: branch work',
		message: 'Fixture: branch work',
		authors: [{ user: 'sgugger' }],
		date: day(2)
	},
	commits[24]
];

export const patch = `diff --git a/README.md b/README.md
index 3b18e51..a1b2c3d 100644
--- a/README.md
+++ b/README.md
@@ -1,4 +1,5 @@
 # GPT-2
\x20
-Old intro <script>window.pwned = true</script>
+New intro <img src=x onerror="window.pwned = true">
+Second new line
 Unchanged
diff --git a/model.safetensors b/model.safetensors
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/model.safetensors
@@ -0,0 +1,3 @@
+version https://git-lfs.github.com/spec/v1
+oid sha256:${'c'.repeat(64)}
+size 548105171
diff --git a/old.txt b/old.txt
deleted file mode 100644
index d95f3ad..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..8f4e2a1
Binary files /dev/null and b/logo.png differ
`;

export const readme = `---
license: mit
---

# GPT-2 fixture

See the [usage docs](docs/usage.md) and ![plot](assets/plot.png).

<script>window.pwned = true</script>
`;

export const usageDoc = `# Usage

Back to the [readme](../README.md), see [api](api.md) and ![img](images/a.png).
`;

export const config = `{
  "activation_function": "gelu_new",
  "architectures": [
    "GPT2LMHeadModel"
  ],
  "n_layer": 12
}
`;

// 1x1 transparent png.
export const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

export interface FilesHubOptions {
	// Status for the tree listing of every path.
	tree?: number;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
	status,
	contentType: 'application/json',
	headers,
	body: JSON.stringify(body)
});

// Installs the api and resolve routes and records every request url.
export async function mockFilesHub(page: Page, options: FilesHubOptions = {}) {
	const calls: URL[] = [];
	const repoInfo = {
		_id: '621ffdc036468d709f17434d',
		id: REPO,
		private: false,
		gated: false,
		author: 'openai-community',
		sha: SHA,
		lastModified: day(0),
		likes: 4141,
		downloads: 15439333,
		tags: ['transformers', 'text-generation', 'license:mit'],
		pipeline_tag: 'text-generation',
		library_name: 'transformers',
		siblings: [
			{ rfilename: 'README.md' },
			{ rfilename: 'config.json' },
			{ rfilename: 'model.safetensors' }
		],
		createdAt: '2022-03-02T23:29:04.000Z'
	};
	const notFound = (route: Route) =>
		route.fulfill(json({ error: 'Entry not found' }, 404, { 'x-error-code': 'EntryNotFound' }));

	await page.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		calls.push(url);
		const segments = url.pathname.split('/').slice(1).map(decodeURIComponent);
		if (url.pathname === '/api/whoami-v2') {
			return route.fulfill(json({ type: 'user', name: 'alice', fullname: 'Alice' }));
		}
		if (
			segments[0] !== 'api' ||
			segments[1] !== 'models' ||
			`${segments[2]}/${segments[3]}` !== REPO
		) {
			return route.fulfill(json({ error: 'not mocked' }, 404));
		}
		const [, , , , kind, ...rest] = segments;
		if (kind === undefined) return route.fulfill(json(repoInfo));
		if (kind === 'refs') return route.fulfill(json(refs));
		if (kind === 'tree') {
			if (options.tree && options.tree !== 200)
				return route.fulfill(json({ error: 'nope' }, options.tree));
			const [rev, ...path] = rest;
			const key = `${rev}:${path.join('/')}`;
			if (key === 'main:' && url.searchParams.get('cursor') === 'c2') {
				return route.fulfill(json(trees['main:page2']));
			}
			const items = trees[key];
			if (!items) return notFound(route);
			const headers: Record<string, string> = {};
			if (key === 'main:' && !url.searchParams.has('cursor')) {
				headers.link = `<${url.origin}${url.pathname}?cursor=c2&expand=true>; rel="next"`;
			}
			return route.fulfill(json(items, 200, headers));
		}
		if (kind === 'paths-info') return route.fulfill(json({ error: 'not implemented' }, 404));
		if (kind === 'commits') {
			const rev = rest[0];
			const limit = Number(url.searchParams.get('limit') ?? 20);
			const p = Number(url.searchParams.get('p') ?? 0);
			let list = rev === 'main' ? commits : rev === 'feat/branch' ? branchCommits : null;
			if (!list) {
				const at = commits.findIndex((c) => c.id === rev);
				if (at < 0) return notFound(route);
				list = commits.slice(at);
			}
			const items = list.slice(p * limit, (p + 1) * limit);
			const headers: Record<string, string> = { 'x-total-count': String(list.length) };
			if ((p + 1) * limit < list.length) {
				headers.link = `<${url.origin}${url.pathname}?p=${p + 1}&limit=${limit}>; rel="next"`;
			}
			return route.fulfill(json(items, 200, headers));
		}
		if (kind === 'compare') {
			const [base, head] = rest[0].split('..');
			if (base !== `${head}^`) return route.fulfill(json({ error: 'unexpected compare' }, 400));
			const text = (body: string) =>
				route.fulfill({ status: 200, contentType: 'text/plain', body });
			if (head === SHA) return text(patch);
			if (head === EMPTY_SHA) return text('');
			if (head === BIG_SHA)
				return text(
					`diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -0,0 +1 @@\n+${'x'.repeat(3 * 1024 * 1024)}\n`
				);
			return route.fulfill(json({ error: `Revision "${base}" not found` }, 404));
		}
		return route.fulfill(json({ error: 'not mocked' }, 404));
	});

	await page.route('**/resolve/**', async (route) => {
		const url = new URL(route.request().url());
		calls.push(url);
		const segments = url.pathname.split('/').slice(1).map(decodeURIComponent);
		const [owner, name, , rev, ...path] = segments;
		if (`${owner}/${name}` !== REPO) return notFound(route);
		const file = path.join('/');
		const headers = route.request().headers();
		const text = (body: string, contentType = 'text/plain; charset=utf-8') =>
			route.fulfill({
				status: 200,
				contentType,
				body,
				headers: { 'content-length': String(Buffer.byteLength(body)) }
			});
		const bytes = (body: Uint8Array<ArrayBuffer>, contentType: string) => {
			const reply = rangeReply(body, headers['range'] ?? null, contentType);
			return route.fulfill({
				status: reply.status,
				headers: reply.headers,
				body: Buffer.from(reply.body)
			});
		};
		if (rev === 'feat/branch' && file === 'only-on-branch.txt') return text('branch\n');
		if (rev !== 'main' && rev !== 'v1.0' && rev !== SHA) return notFound(route);
		switch (file) {
			case 'README.md':
				return text(readme, 'text/markdown; charset=utf-8');
			case 'docs/usage.md':
				return text(usageDoc, 'text/markdown; charset=utf-8');
			case 'config.json':
				return text(config, 'application/json');
			case 'mystery.xyz':
				return text('plain text, no extension\n');
			case 'blob.dat':
				return bytes(
					new Uint8Array([0, 1, 2, 3, 255, 254, 0, 0, 7, 8, 9, 10]),
					'application/octet-stream'
				);
			case 'big.txt':
				return text('a'.repeat(3 * 1024 * 1024));
			case 'private.txt':
				if (headers['authorization'] !== 'Bearer hf_good') {
					return route.fulfill(json({ error: 'Invalid credentials in Authorization header' }, 401));
				}
				return text('secret\n');
			case 'assets/plot.png':
			case 'logo.png':
				return bytes(new Uint8Array(png), 'image/png');
			case 'model.safetensors':
				return bytes(tinySafetensors(), 'application/octet-stream');
			case 'tiny.gguf':
				return bytes(tinyGguf(), 'application/octet-stream');
			default:
				return notFound(route);
		}
	});
	await page.route('https://cdn-avatars.example/**', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'
		})
	);
	return calls;
}
