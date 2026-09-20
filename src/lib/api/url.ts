export type RepoType = 'model' | 'dataset' | 'space';

const apiNamespace: Record<RepoType, string> = {
	model: 'models',
	dataset: 'datasets',
	space: 'spaces'
};

const pagePrefix: Record<RepoType, string> = { model: '', dataset: '/datasets', space: '/spaces' };

export function encodeSegments(path: string): string {
	return path.split('/').map(encodeURIComponent).join('/');
}

export function encodeRev(rev: string): string {
	return encodeURIComponent(rev);
}

export function listApiPath(type: RepoType): string {
	return `/api/${apiNamespace[type]}`;
}

export function repoApiPath(type: RepoType, id: string): string {
	return `${listApiPath(type)}/${encodeSegments(id)}`;
}

export function listPagePath(type: RepoType): string {
	return `/${apiNamespace[type]}`;
}

// Route namespace (models|datasets|spaces or none) to repo type.
export function repoTypeOf(namespace?: string): RepoType {
	return namespace === 'datasets' ? 'dataset' : namespace === 'spaces' ? 'space' : 'model';
}

export function repoPagePath(type: RepoType, id: string): string {
	return `${pagePrefix[type]}/${encodeSegments(id)}`;
}

function revPath(kind: string, type: RepoType, id: string, rev: string, path: string): string {
	const base = `${repoPagePath(type, id)}/${kind}/${encodeRev(rev)}`;
	return path ? `${base}/${encodeSegments(path)}` : base;
}

export function treePagePath(type: RepoType, id: string, rev: string, path = ''): string {
	return revPath('tree', type, id, rev, path);
}

export function blobPagePath(type: RepoType, id: string, rev: string, path: string): string {
	return revPath('blob', type, id, rev, path);
}

export function commitsPagePath(type: RepoType, id: string, rev: string): string {
	return revPath('commits', type, id, rev, '');
}

export function commitPagePath(type: RepoType, id: string, sha: string): string {
	return revPath('commit', type, id, sha, '');
}

export function resolvePath(type: RepoType, id: string, rev: string, path: string): string {
	return revPath('resolve', type, id, rev, path);
}

export type FileAction = 'upload' | 'new' | 'edit' | 'delete';

// Management pages mirror the hub: /{repo}/upload|new|edit|delete/{rev}[/{path}].
export function fileActionPath(
	action: FileAction,
	type: RepoType,
	id: string,
	rev: string,
	path = ''
): string {
	return revPath(action, type, id, rev, path);
}

export function downloadPath(type: RepoType, id: string, rev: string, path: string): string {
	return `${resolvePath(type, id, rev, path)}?download=true`;
}

// Longest known ref wins, so `refs/pr/1/dir` splits into rev `refs/pr/1` and path `dir`.
export function splitRevPath(rest: string, refs: readonly string[]): { rev: string; path: string } {
	let rev = '';
	for (const ref of refs) {
		if (ref.length <= rev.length) continue;
		if (rest === ref || rest.startsWith(ref + '/')) rev = ref;
	}
	if (!rev) rev = rest.split('/')[0];
	return { rev, path: rest.slice(rev.length + 1) };
}

export function parseLinkHeader(value: string | null): Record<string, string> {
	const links: Record<string, string> = {};
	if (!value) return links;
	for (const match of value.matchAll(/<([^>]*)>\s*;\s*rel="?([^";,]+)"?/g)) {
		links[match[2]] = match[1];
	}
	return links;
}

// Keeps the cursor opaque and confines the follow-up request to the endpoint that issued it.
export function nextPagePath(link: string | null, endpointPath: string): string | null {
	const next = parseLinkHeader(link).next;
	if (!next) return null;
	const url = new URL(next, 'http://hub.invalid');
	if (url.pathname !== endpointPath) return null;
	return url.pathname + url.search;
}
