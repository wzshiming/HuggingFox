// Shared fixtures for the selfhosted project: the per-run token, an API helper that seeds
// repositories through the hub's own endpoints, and deterministic file contents.
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export type SelfhostedOptions = { token: string };
export type RepoType = 'model' | 'dataset' | 'space';
// A file to write (content) or to delete (no content).
export type Op = { path: string; content?: string | Buffer };

const apiPrefix = (type: RepoType) => `/api/${type}s`;
const resolvePrefix = (type: RepoType, id: string) =>
	type === 'model' ? `/${id}` : `/${type}s/${id}`;

export interface Hub {
	owner: string;
	request: APIRequestContext;
	json<T = unknown>(path: string): Promise<T>;
	create(type: RepoType, name: string): Promise<string>;
	commit(type: RepoType, id: string, branch: string, ops: Op[], parent?: string): Promise<string>;
	tip(type: RepoType, id: string, rev?: string): Promise<string>;
	text(type: RepoType, id: string, rev: string, path: string): Promise<string>;
}

export const test = base.extend<SelfhostedOptions & { hub: Hub }>({
	token: ['', { option: true }],
	hub: async ({ request, token }, use) => {
		const headers = { Authorization: `Bearer ${token}` };
		const ok = async (res: Awaited<ReturnType<APIRequestContext['fetch']>>) => {
			expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBe(true);
			return res;
		};
		const json = async <T>(path: string) =>
			(await ok(await request.get(path))).json() as Promise<T>;
		const who = (await (await ok(await request.get('/api/whoami-v2', { headers }))).json()) as {
			name: string;
		};
		const tip = async (type: RepoType, id: string, rev = 'main') =>
			(await json<{ sha: string }>(`${apiPrefix(type)}/${id}/revision/${encodeURIComponent(rev)}`))
				.sha;
		await use({
			owner: who.name,
			request,
			json,
			tip,
			async create(type, name) {
				await ok(
					await request.post('/api/repos/create', {
						headers,
						data: { type, name, organization: who.name, private: false }
					})
				);
				return `${who.name}/${name}`;
			},
			async commit(type, id, branch, ops, parent) {
				const lines = [
					{
						key: 'header',
						value: { summary: `Seed ${ops.map((op) => op.path).join(', ')}`, parentCommit: parent }
					},
					...ops.map((op) =>
						op.content === undefined
							? { key: 'deletedFile', value: { path: op.path } }
							: {
									key: 'file',
									value: {
										path: op.path,
										content: Buffer.from(op.content).toString('base64'),
										encoding: 'base64'
									}
								}
					)
				];
				const res = await ok(
					await request.post(`${apiPrefix(type)}/${id}/commit/${encodeURIComponent(branch)}`, {
						headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
						data: lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
					})
				);
				return ((await res.json()) as { commitOid: string }).commitOid;
			},
			async text(type, id, rev, path) {
				return (
					await ok(
						await request.get(
							`${resolvePrefix(type, id)}/resolve/${encodeURIComponent(rev)}/${path}`
						)
					)
				).text();
			}
		});
	}
});
export { expect };

export const unique = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}`;

export const signIn = (page: Page, token: string) =>
	page.addInitScript((value) => localStorage.setItem('hfx.token', value), token);

export const overflow = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// README exercising markdown, KaTeX math, highlighted code and a relative image link.
export const readme = (image: string) => `---
license: mit
pipeline_tag: text-generation
tags:
  - selfhosted-fixture
---

# Fixture model

Inline math $E = mc^2$ and a block:

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

\`\`\`python
def greet(name: str) -> str:
    return f"hello {name}"
\`\`\`

![dot](${image})
`;

// Solid-colour RGB PNG, valid for any decoder, small enough to inline in a commit.
export function png(width: number, height: number, rgb: [number, number, number]): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(typed));
		return Buffer.concat([length, typed, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.writeUInt8(8, 8); // bit depth
	header.writeUInt8(2, 9); // colour type: truecolour
	const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
	const raw = Buffer.concat(Array.from({ length: height }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}
