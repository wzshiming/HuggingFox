import { ApiError, createClient } from '$lib/api/client';
import type { WhoAmI } from '$lib/api/types';

export const TOKEN_KEY = 'hfx.token';

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createAuth({
	storage,
	fetch: fetchImpl
}: {
	storage: TokenStorage | null;
	fetch?: typeof fetch;
}) {
	let token = $state<string | null>(storage?.getItem(TOKEN_KEY) ?? null);
	let user = $state<WhoAmI | null>(null);
	let pending = $state(false);
	let session = $state(0);
	// Set when the stored token could not be checked (hub down); cleared by the next attempt or sign-out.
	let restoreError = $state.raw<unknown>();
	// Only the newest login/logout/restore may commit its result.
	let seq = 0;

	const hub = createClient({ fetch: fetchImpl, token: () => token });

	function reset() {
		seq++;
		token = null;
		user = null;
		pending = false;
		restoreError = undefined;
		storage?.removeItem(TOKEN_KEY);
		session++;
	}

	async function login(candidate: string): Promise<void> {
		const mine = ++seq;
		pending = true;
		try {
			const me = await hub.whoami({ token: candidate });
			if (mine !== seq) return;
			token = candidate;
			user = me;
			restoreError = undefined;
			storage?.setItem(TOKEN_KEY, candidate);
			session++;
		} catch (error) {
			if (mine === seq) throw error;
		} finally {
			if (mine === seq) pending = false;
		}
	}

	async function restore(): Promise<void> {
		if (!token) return;
		const mine = ++seq;
		pending = true;
		restoreError = undefined;
		try {
			const me = await hub.whoami();
			if (mine === seq) user = me;
		} catch (error) {
			const rejected = error instanceof ApiError && (error.status === 401 || error.status === 403);
			if (mine !== seq) return;
			if (rejected) reset();
			else restoreError = error;
		} finally {
			if (mine === seq) pending = false;
		}
	}

	return {
		hub,
		get token() {
			return token;
		},
		get user() {
			return user;
		},
		get pending() {
			return pending;
		},
		get session() {
			return session;
		},
		get restoreError() {
			return restoreError;
		},
		login,
		logout: reset,
		restore
	};
}

export const auth = createAuth({
	storage: typeof localStorage === 'undefined' ? null : localStorage
});

export const hub = auth.hub;
