import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client.ts';
import { commitFiles, uploadFiles, writeError, type WriteProgress } from './write.ts';

const session = { hubUrl: 'http://hub.test', accessToken: 'hf_write' };
const target = { type: 'dataset' as const, id: 'org/set' };

interface Seen {
	method: string;
	url: URL;
	auth: string | null;
	body: string;
}

interface HubOptions {
	// Files at or above this size are reported as LFS by preupload.
	lfsFrom?: number;
	lfsOrigin?: string;
	commitStatus?: number;
	holdPreupload?: boolean;
}

// Fake hub speaking the commit protocol the SDK expects: preupload, LFS batch, PUT, ndjson commit.
function fakeHub({
	lfsFrom = 1024,
	lfsOrigin,
	commitStatus = 200,
	holdPreupload = false
}: HubOptions = {}) {
	const seen: Seen[] = [];
	const stored = new Map<string, Uint8Array>();
	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	const held: ((response: Response) => void)[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		const bytes = new Uint8Array(await request.arrayBuffer());
		const url = new URL(request.url);
		const body = new TextDecoder().decode(bytes);
		seen.push({ method: request.method, url, auth: request.headers.get('authorization'), body });
		const signal = init?.signal;
		signal?.throwIfAborted();
		if (url.pathname.includes('/preupload/')) {
			const { files } = JSON.parse(body) as { files: { path: string; size: number }[] };
			const reply = json({
				files: files.map((f) => ({
					path: f.path,
					uploadMode: f.size >= lfsFrom ? 'lfs' : 'regular'
				}))
			});
			if (!holdPreupload) return reply;
			return new Promise<Response>((resolve, reject) => {
				held.push(resolve);
				signal?.addEventListener('abort', () => reject(signal.reason));
			});
		}
		if (url.pathname.endsWith('.git/info/lfs/objects/batch')) {
			const { objects } = JSON.parse(body) as { objects: { oid: string; size: number }[] };
			return json({
				transfer: 'basic',
				objects: objects.map((o) => ({
					oid: o.oid,
					size: o.size,
					actions: { upload: { href: `${lfsOrigin ?? url.origin}/lfs-upload/${o.oid}` } }
				}))
			});
		}
		if (url.pathname.startsWith('/lfs-upload/')) {
			stored.set(url.pathname.slice('/lfs-upload/'.length), bytes);
			return new Response(null, { status: 200 });
		}
		if (url.pathname.includes('/commit/')) {
			if (commitStatus !== 200) {
				return json(
					{ error: 'A commit has happened since. Please refresh and try again.' },
					commitStatus
				);
			}
			return json({
				commitUrl: `${url.origin}/x/commit/newsha`,
				commitOid: 'newsha',
				hookOutput: ''
			});
		}
		return json({ error: `unexpected ${request.method} ${url.pathname}` }, 500);
	};
	vi.stubGlobal('fetch', fetchImpl);
	return { seen, stored, held };
}

const ndjson = (body: string) => body.split('\n').map((line) => JSON.parse(line));
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
	Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

afterEach(() => vi.unstubAllGlobals());

describe('commitFiles', () => {
	it('accepts a hub-defined token without an HF prefix', async () => {
		const { seen } = fakeHub();
		const result = await commitFiles({ ...session, accessToken: 'local-test-token' }, target, {
			branch: 'main',
			parentCommit: 'abc123',
			title: 'Update notes',
			operations: [{ path: 'notes.txt', content: new Blob(['notes']) }]
		});
		expect(result.oid).toBe('newsha');
		expect(seen).toHaveLength(2);
		expect(seen.every((request) => request.auth === 'Bearer local-test-token')).toBe(true);
	});

	it('commits a small text file with the parent guard and no LFS or xet round trips', async () => {
		const { seen } = fakeHub();
		const result = await commitFiles(session, target, {
			branch: 'feat/x',
			parentCommit: 'abc123',
			title: 'Update README.md',
			description: 'why',
			operations: [{ path: 'README.md', content: new Blob(['# hi']) }]
		});
		expect(result).toEqual({ oid: 'newsha' });
		expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
			'POST /api/datasets/org/set/preupload/feat%2Fx',
			'POST /api/datasets/org/set/commit/feat%2Fx'
		]);
		expect(seen.every((s) => s.url.origin === 'http://hub.test')).toBe(true);
		expect(seen.every((s) => s.auth === 'Bearer hf_write')).toBe(true);
		expect(JSON.parse(seen[0].body).files).toEqual([
			{ path: 'README.md', size: 4, sample: btoa('# hi') }
		]);
		expect(ndjson(seen[1].body)).toEqual([
			{
				key: 'header',
				value: { summary: 'Update README.md', description: 'why', parentCommit: 'abc123' }
			},
			{ key: 'file', value: { path: 'README.md', content: btoa('# hi'), encoding: 'base64' } }
		]);
	});

	it('deletes a file with a single commit request', async () => {
		const { seen } = fakeHub();
		await commitFiles(
			session,
			{ type: 'model', id: 'u/m' },
			{
				branch: 'main',
				parentCommit: 'abc123',
				title: 'Delete old.txt',
				operations: [{ path: 'old.txt', delete: true }]
			}
		);
		expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
			'POST /api/models/u/m/commit/main'
		]);
		expect(ndjson(seen[0].body)).toEqual([
			{ key: 'header', value: { summary: 'Delete old.txt', parentCommit: 'abc123' } },
			{ key: 'deletedFile', value: { path: 'old.txt' } }
		]);
	});

	it('surfaces a stale parent as a status error and keeps the abort distinct', async () => {
		fakeHub({ commitStatus: 412 });
		const err = await commitFiles(session, target, {
			branch: 'main',
			parentCommit: 'old',
			title: 't',
			operations: [{ path: 'a.txt', content: new Blob(['a']) }]
		}).catch((e) => e);
		expect(writeError(err)).toEqual({
			status: 412,
			detail: 'A commit has happened since. Please refresh and try again.',
			aborted: false
		});
		expect(writeError(new ApiError(409, 'exists', '/api/repos/move'))).toEqual({
			status: 409,
			detail: 'exists',
			aborted: false
		});
		expect(writeError(new Error('offline'))).toEqual({
			status: null,
			detail: 'offline',
			aborted: false
		});
	});

	it('does not start when the signal is already aborted', async () => {
		const { seen } = fakeHub();
		const controller = new AbortController();
		controller.abort();
		const err = await commitFiles(session, target, {
			branch: 'main',
			parentCommit: 'abc',
			title: 't',
			signal: controller.signal,
			operations: [{ path: 'a.txt', content: new Blob(['a']) }]
		}).catch((e) => e);
		expect(writeError(err).aborted).toBe(true);
		expect(seen).toHaveLength(0);
	});

	it('cancels an in-flight commit and never reaches the commit endpoint', async () => {
		const { seen } = fakeHub({ holdPreupload: true });
		const controller = new AbortController();
		const pending = commitFiles(session, target, {
			branch: 'main',
			parentCommit: 'abc',
			title: 't',
			signal: controller.signal,
			operations: [{ path: 'a.txt', content: new Blob(['a']) }]
		}).catch((e) => e);
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		controller.abort();
		const err = await pending;
		expect(writeError(err).aborted).toBe(true);
		expect(seen.map((s) => s.url.pathname)).toEqual(['/api/datasets/org/set/preupload/main']);
	});
});

describe('uploadFiles', () => {
	it('uses a custom token for hub requests without sending it to external LFS storage', async () => {
		const { seen, stored } = fakeHub({ lfsFrom: 1, lfsOrigin: 'https://storage.test' });
		const result = await uploadFiles({ ...session, accessToken: 'local-upload-token' }, target, {
			branch: 'main',
			parentCommit: 'abc123',
			title: 'Upload weights',
			files: [{ path: 'weights.bin', content: new Blob(['weights']) }]
		});
		expect(result.oid).toBe('newsha');
		const hubRequests = seen.filter((request) => request.url.origin === session.hubUrl);
		expect(hubRequests).toHaveLength(3);
		expect(hubRequests.every((request) => request.auth === 'Bearer local-upload-token')).toBe(true);
		const storageRequests = seen.filter((request) => request.url.origin === 'https://storage.test');
		expect(storageRequests).toHaveLength(1);
		expect(storageRequests[0].auth).toBeNull();
		expect(stored.size).toBe(1);
	});

	it('uploads large files through basic LFS and reports true phases', async () => {
		const { seen, stored } = fakeHub({ lfsFrom: 1024 });
		const big = new Uint8Array(2048).map((_, i) => i % 251);
		const events: WriteProgress[] = [];
		const result = await uploadFiles(session, target, {
			branch: 'main',
			parentCommit: 'abc123',
			title: 'Upload 2 files',
			files: [
				{ path: 'weights/big.bin', content: new Blob([big]) },
				{ path: 'small.txt', content: new Blob(['x']) }
			],
			onProgress: (event) => events.push(event)
		});
		expect(result).toEqual({ oid: 'newsha' });
		const oid = await sha256(big);
		expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
			'POST /api/datasets/org/set/preupload/main',
			'POST /datasets/org/set.git/info/lfs/objects/batch',
			`PUT /lfs-upload/${oid}`,
			'POST /api/datasets/org/set/commit/main'
		]);
		const batch = JSON.parse(seen[1].body);
		expect(batch.transfers).toEqual(['basic', 'multipart']);
		expect(batch.hash_algo).toBe('sha_256');
		expect(batch.ref).toEqual({ name: 'main' });
		expect(batch.objects).toEqual([{ oid, size: 2048 }]);
		expect(seen[1].auth).toBe('Bearer hf_write');
		expect(stored.get(oid)).toEqual(big);
		expect(ndjson(seen[3].body)).toEqual([
			{ key: 'header', value: { summary: 'Upload 2 files', parentCommit: 'abc123' } },
			{ key: 'lfsFile', value: { path: 'weights/big.bin', algo: 'sha256', size: 2048, oid } },
			{ key: 'file', value: { path: 'small.txt', content: btoa('x'), encoding: 'base64' } }
		]);
		const phases = events.filter((e) => e.event === 'phase').map((e) => e.phase);
		expect(phases).toEqual(['preuploading', 'uploadingLargeFiles', 'committing']);
		const bigEvents = events.filter(
			(e) => e.event === 'fileProgress' && e.path === 'weights/big.bin'
		);
		expect(bigEvents.some((e) => e.event === 'fileProgress' && e.state === 'hashing')).toBe(true);
		expect(bigEvents.at(-1)).toMatchObject({ state: 'uploading', progress: 1 });
	});

	it('rejects an empty selection before touching the hub', async () => {
		const { seen } = fakeHub();
		await expect(
			uploadFiles(session, target, { branch: 'main', parentCommit: 'abc', title: 't', files: [] })
		).rejects.toThrow(/no files/i);
		expect(seen).toHaveLength(0);
	});
});
