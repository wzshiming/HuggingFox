import { auth } from '$lib/auth.svelte';

export interface Query<T> {
	readonly data: T | undefined;
	readonly error: unknown;
	readonly pending: boolean;
	retry(): void;
}

// Re-runs when anything load() reads changes, on retry and on sign-in/out; stale responses are aborted.
export function createQuery<T>(load: (signal: AbortSignal) => Promise<T>): Query<T> {
	let data = $state.raw<T | undefined>();
	let error = $state.raw<unknown>();
	let pending = $state(true);
	let attempt = $state(0);

	$effect(() => {
		void auth.session;
		void attempt;
		const controller = new AbortController();
		data = undefined;
		error = undefined;
		pending = true;
		load(controller.signal).then(
			(value) => {
				if (controller.signal.aborted) return;
				data = value;
				pending = false;
			},
			(reason) => {
				if (controller.signal.aborted) return;
				error = reason;
				pending = false;
			}
		);
		return () => controller.abort();
	});

	return {
		get data() {
			return data;
		},
		get error() {
			return error;
		},
		get pending() {
			return pending;
		},
		retry() {
			attempt++;
		}
	};
}
