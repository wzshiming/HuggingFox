import type { WriteSession } from '$lib/api/write';
import { auth } from '$lib/auth.svelte';

export interface Action {
	readonly pending: boolean;
	readonly error: unknown;
	// Resolves undefined when the run failed or was aborted (cancel, sign-out, unmount).
	run<T>(task: (session: WriteSession, signal: AbortSignal) => Promise<T>): Promise<T | undefined>;
	cancel(): void;
	clear(): void;
}

// One write at a time; the token is snapshotted when the run starts.
export function createAction(): Action {
	let pending = $state(false);
	let error = $state.raw<unknown>();
	let controller: AbortController | undefined;

	function cancel() {
		controller?.abort();
		controller = undefined;
		pending = false;
	}

	// A new auth session (sign-out or account switch) and unmounting abort the in-flight write.
	$effect(() => {
		void auth.session;
		return cancel;
	});

	async function run<T>(task: (session: WriteSession, signal: AbortSignal) => Promise<T>) {
		const token = auth.token;
		if (!token || controller) return undefined;
		const mine = new AbortController();
		controller = mine;
		pending = true;
		error = undefined;
		try {
			const result = await task({ hubUrl: location.origin, accessToken: token }, mine.signal);
			return mine.signal.aborted ? undefined : result;
		} catch (reason) {
			if (!mine.signal.aborted) error = reason;
			return undefined;
		} finally {
			if (controller === mine) {
				controller = undefined;
				pending = false;
			}
		}
	}

	return {
		get pending() {
			return pending;
		},
		get error() {
			return error;
		},
		run,
		cancel,
		clear() {
			error = undefined;
		}
	};
}
