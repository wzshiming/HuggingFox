import { describe, expect, it } from 'vitest';
import { ApiError } from './api/client.ts';
import { createAuth, TOKEN_KEY } from './auth.svelte.ts';

function memoryStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k)
	};
}

type Reply = { status: number; body: unknown };

function deferredFetch() {
	const pending: { url: string; auth: string | null; resolve: (reply: Reply) => void }[] = [];
	const fetchImpl: typeof fetch = (input, init) =>
		new Promise((resolve) => {
			pending.push({
				url: String(input),
				auth: new Headers(init?.headers).get('authorization'),
				resolve: ({ status, body }) =>
					resolve(
						new Response(JSON.stringify(body), {
							status,
							headers: { 'content-type': 'application/json' }
						})
					)
			});
		});
	return { pending, fetchImpl };
}

const user = (name: string) => ({ type: 'user', name, fullname: name });

describe('login', () => {
	it('validates the token with whoami before storing it', async () => {
		const storage = memoryStorage();
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		const login = auth.login('hf_candidate');
		expect(auth.pending).toBe(true);
		expect(storage.getItem(TOKEN_KEY)).toBe(null);
		expect(pending[0].auth).toBe('Bearer hf_candidate');
		pending[0].resolve({ status: 200, body: user('alice') });
		await login;
		expect(auth.token).toBe('hf_candidate');
		expect(auth.user?.name).toBe('alice');
		expect(auth.pending).toBe(false);
		expect(storage.getItem(TOKEN_KEY)).toBe('hf_candidate');
	});

	it('rejects with the api error and stores nothing on 401', async () => {
		const storage = memoryStorage();
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		const login = auth.login('hf_bad');
		pending[0].resolve({ status: 401, body: { error: 'Invalid credentials' } });
		const err = await login.catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(401);
		expect(err.message).not.toContain('hf_bad');
		expect(auth.token).toBe(null);
		expect(auth.user).toBe(null);
		expect(storage.getItem(TOKEN_KEY)).toBe(null);
	});

	it('keeps only the most recent login attempt', async () => {
		const storage = memoryStorage();
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		const first = auth.login('hf_first');
		const second = auth.login('hf_second');
		pending[1].resolve({ status: 200, body: user('second') });
		await second;
		pending[0].resolve({ status: 200, body: user('first') });
		await first;
		expect(auth.token).toBe('hf_second');
		expect(auth.user?.name).toBe('second');
		expect(storage.getItem(TOKEN_KEY)).toBe('hf_second');
		expect(auth.pending).toBe(false);
	});

	it('sends the stored token on later hub requests only', async () => {
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage: memoryStorage(), fetch: fetchImpl });
		const anonymous = auth.hub.info('model', 'u/r');
		expect(pending[0].auth).toBe(null);
		pending[0].resolve({ status: 200, body: { id: 'u/r' } });
		await anonymous;
		const login = auth.login('hf_token');
		pending[1].resolve({ status: 200, body: user('alice') });
		await login;
		const signedIn = auth.hub.info('model', 'u/r');
		expect(pending[2].auth).toBe('Bearer hf_token');
		pending[2].resolve({ status: 200, body: { id: 'u/r' } });
		await signedIn;
	});
});

describe('logout', () => {
	it('clears the token, user and storage and starts a new session', async () => {
		const storage = memoryStorage({ [TOKEN_KEY]: 'hf_saved' });
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		const restore = auth.restore();
		pending[0].resolve({ status: 200, body: user('alice') });
		await restore;
		expect(auth.user?.name).toBe('alice');
		const before = auth.session;
		auth.logout();
		expect(auth.token).toBe(null);
		expect(auth.user).toBe(null);
		expect(storage.getItem(TOKEN_KEY)).toBe(null);
		expect(auth.session).not.toBe(before);
	});

	it('ignores a whoami reply that lands after logout', async () => {
		const storage = memoryStorage();
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		const login = auth.login('hf_slow');
		auth.logout();
		pending[0].resolve({ status: 200, body: user('slow') });
		await login;
		expect(auth.token).toBe(null);
		expect(auth.user).toBe(null);
		expect(auth.pending).toBe(false);
		expect(storage.getItem(TOKEN_KEY)).toBe(null);
	});
});

describe('restore', () => {
	it('drops a stored token the hub rejects', async () => {
		const storage = memoryStorage({ [TOKEN_KEY]: 'hf_expired' });
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		expect(auth.token).toBe('hf_expired');
		const restore = auth.restore();
		expect(pending[0].auth).toBe('Bearer hf_expired');
		pending[0].resolve({ status: 401, body: { error: 'Invalid credentials' } });
		await restore;
		expect(auth.token).toBe(null);
		expect(storage.getItem(TOKEN_KEY)).toBe(null);
	});

	it('keeps the token when the hub is unavailable', async () => {
		const storage = memoryStorage({ [TOKEN_KEY]: 'hf_saved' });
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		const restore = auth.restore();
		pending[0].resolve({ status: 503, body: { error: 'down' } });
		await restore;
		expect(auth.token).toBe('hf_saved');
		expect(auth.user).toBe(null);
		expect(auth.pending).toBe(false);
	});

	it('exposes a soft failure until a retried whoami succeeds', async () => {
		const storage = memoryStorage({ [TOKEN_KEY]: 'hf_saved' });
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		expect(auth.restoreError).toBeUndefined();
		const first = auth.restore();
		pending[0].resolve({ status: 503, body: { error: 'down' } });
		await first;
		expect(auth.restoreError).toBeInstanceOf(ApiError);
		expect((auth.restoreError as ApiError).status).toBe(503);
		expect(auth.token).toBe('hf_saved');
		const second = auth.restore();
		expect(auth.pending).toBe(true);
		expect(auth.restoreError).toBeUndefined();
		pending[1].resolve({ status: 200, body: user('alice') });
		await second;
		expect(auth.user?.name).toBe('alice');
		expect(auth.restoreError).toBeUndefined();
	});

	it('keeps the verified user when a later whoami fails softly', async () => {
		const storage = memoryStorage({ [TOKEN_KEY]: 'hf_saved' });
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage, fetch: fetchImpl });
		const first = auth.restore();
		pending[0].resolve({ status: 200, body: user('alice') });
		await first;
		const second = auth.restore();
		pending[1].resolve({ status: 503, body: { error: 'down' } });
		await second;
		expect(auth.user?.name).toBe('alice');
		expect(auth.token).toBe('hf_saved');
		expect((auth.restoreError as ApiError).status).toBe(503);
		auth.logout();
		expect(auth.restoreError).toBeUndefined();
	});

	it('does nothing without a stored token', async () => {
		const { pending, fetchImpl } = deferredFetch();
		const auth = createAuth({ storage: memoryStorage(), fetch: fetchImpl });
		await auth.restore();
		expect(pending).toHaveLength(0);
	});
});
