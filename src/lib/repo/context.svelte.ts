import { getContext, setContext } from 'svelte';
import type { RepoInfo, RepoRefs } from '$lib/api/types';
import { splitRevPath, type RepoType } from '$lib/api/url';
import { hub } from '$lib/auth.svelte';
import { createQuery, type Query } from '$lib/query.svelte';

export interface RepoContext {
	readonly type: RepoType;
	readonly id: string;
	readonly info: Query<RepoInfo>;
	readonly refs: Query<RepoRefs>;
	// Default branch once refs settled (main, else the first branch); null while loading.
	readonly rev: string | null;
	// Refetches info and refs after a write moved the repository on.
	refresh(): void;
}

const key = Symbol('repo');

export function provideRepo(target: () => { type: RepoType; id: string }): RepoContext {
	const info = createQuery((signal) => hub.info(target().type, target().id, {}, { signal }));
	const refs = createQuery((signal) => hub.refs(target().type, target().id, {}, { signal }));
	const rev = $derived.by(() => {
		if (refs.pending) return null;
		const branches = refs.data?.branches ?? [];
		return (branches.find((b) => b.name === 'main') ?? branches[0])?.name ?? 'main';
	});
	const context: RepoContext = {
		get type() {
			return target().type;
		},
		get id() {
			return target().id;
		},
		info,
		refs,
		get rev() {
			return rev;
		},
		refresh() {
			info.retry();
			refs.retry();
		}
	};
	return setContext(key, context);
}

export function useRepo(): RepoContext {
	return getContext(key);
}

// Branches and tags are addressed by name; convert and PR refs by their full ref (refs/convert/parquet).
export function refNames(refs: RepoRefs | undefined): string[] {
	if (!refs) return [];
	return [
		...refs.branches.map((r) => r.name),
		...refs.tags.map((r) => r.name),
		...refs.converts.map((r) => r.ref),
		...(refs.pullRequests ?? []).map((r) => r.ref)
	];
}

// Rev and path of a tree/blob/commits url tail; null until the refs settled so slash refs split right.
export function splitTarget(repo: RepoContext, rest: string): { rev: string; path: string } | null {
	if (repo.refs.pending) return null;
	if (!rest) return { rev: repo.rev ?? 'main', path: '' };
	return splitRevPath(rest, refNames(repo.refs.data));
}
