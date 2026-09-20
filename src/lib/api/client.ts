import type {
	Commit,
	Page,
	QuickSearch,
	RepoInfo,
	RepoRefs,
	RepoSummary,
	TagsByType,
	TreeEntry,
	UserOverview,
	WhoAmI
} from './types.ts';
import {
	encodeRev,
	encodeSegments,
	listApiPath,
	nextPagePath,
	repoApiPath,
	resolvePath,
	type RepoType
} from './url.ts';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly detail: string,
		readonly path: string
	) {
		super(`HTTP ${status} ${path}: ${detail}`);
		this.name = 'ApiError';
	}
}

export interface ClientOptions {
	baseUrl?: string;
	fetch?: typeof fetch;
	token?: () => string | null | undefined;
}

export interface RequestOptions {
	signal?: AbortSignal;
	token?: string;
}

// A type alias (not an interface) so it is assignable to the query() record.
export type ListReposParams = {
	search?: string;
	author?: string;
	filter?: string[];
	pipeline_tag?: string[];
	sort?: string;
	direction?: -1 | 1;
	limit?: number;
	expand?: string[];
	full?: boolean;
	config?: boolean;
	// Opaque cursor copied from a previous page's Link header.
	cursor?: string;
};

export interface TextFile {
	text: string;
	size: number | null;
	truncated: boolean;
}

export type SpaceSdk = 'gradio' | 'streamlit' | 'docker' | 'static';

// The management endpoints address a repo by owner and name separately.
function splitRepoId(id: string): { organization: string; name: string } {
	const [organization, name, ...rest] = id.split('/');
	if (!organization || !name || rest.length) throw new Error(`repo id must be owner/name: ${id}`);
	return { organization, name };
}

type Param = string | number | boolean | string[] | undefined;

function query(params: Record<string, Param>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			const name = key === 'expand' ? 'expand[]' : key;
			for (const item of value) search.append(name, item);
		} else {
			search.set(key, String(value));
		}
	}
	const text = search.toString();
	return text ? `?${text}` : '';
}

// Reads at most maxBytes of a body, cancelling the stream instead of downloading the rest.
async function readText(res: Response, maxBytes: number): Promise<TextFile> {
	const length = res.headers.get('content-length');
	const size = length === null ? null : Number(length);
	if (size !== null && size > maxBytes) {
		await res.body?.cancel();
		return { text: '', size, truncated: true };
	}
	if (!res.body) return { text: await res.text(), size, truncated: false };
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let text = '';
	let budget = maxBytes;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value.byteLength > budget) {
			// Streaming decode holds back a code point cut by the budget instead of emitting U+FFFD.
			text += decoder.decode(value.subarray(0, budget), { stream: true });
			await reader.cancel();
			return { text, size, truncated: true };
		}
		budget -= value.byteLength;
		text += decoder.decode(value, { stream: true });
	}
	return { text: text + decoder.decode(), size, truncated: false };
}

const ERROR_BODY_BYTES = 8 * 1024;

// The hub's X-Error-Message spares reading the body; otherwise only its head is read.
export async function errorDetail(res: Response): Promise<string> {
	const header = res.headers.get('x-error-message');
	if (header) {
		await res.body?.cancel().catch(() => undefined);
		return header;
	}
	const { text } = await readText(res, ERROR_BODY_BYTES).catch(() => ({ text: '' }));
	try {
		const body = JSON.parse(text);
		if (typeof body?.error === 'string') return body.error;
	} catch {
		// not json
	}
	return text.slice(0, 200) || res.statusText || `status ${res.status}`;
}

function pageOf<T>(items: T[], res: Response, path: string): Page<T> {
	const total = res.headers.get('x-total-count');
	return {
		items,
		next: nextPagePath(res.headers.get('link'), path),
		total: total === null ? null : Number(total)
	};
}

export function createClient({
	baseUrl = '',
	fetch: fetchImpl = globalThis.fetch,
	token = () => null
}: ClientOptions = {}) {
	async function request(
		path: string,
		{ signal, token: override }: RequestOptions,
		accept = 'application/json',
		init: { method?: string; headers?: Record<string, string>; body?: string } = {}
	): Promise<Response> {
		const headers = new Headers({ accept, ...init.headers });
		const bearer = override ?? token();
		if (bearer) headers.set('authorization', `Bearer ${bearer}`);
		const res = await fetchImpl(baseUrl + path, { ...init, headers, signal });
		if (!res.ok) throw new ApiError(res.status, await errorDetail(res), path.split('?')[0]);
		return res;
	}

	async function getJson<T>(path: string, options: RequestOptions): Promise<T> {
		return (await request(path, options)).json();
	}

	// Management replies may be empty; only the status matters.
	async function sendJson(method: string, path: string, body: unknown, options: RequestOptions) {
		const res = await request(path, options, 'application/json', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		await res.body?.cancel().catch(() => undefined);
	}

	// 404/405 mean the hub does not offer this optional endpoint; auth and server errors still surface.
	async function optional<T>(path: string, options: RequestOptions): Promise<T | null> {
		try {
			return await getJson<T>(path, options);
		} catch (error) {
			if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return null;
			throw error;
		}
	}

	async function page<T>(next: string, options: RequestOptions = {}): Promise<Page<T>> {
		if (!/^\/api\/[^/]/.test(next)) throw new Error(`invalid page path: ${next}`);
		const res = await request(next, options);
		return pageOf<T>(await res.json(), res, next.split('?')[0]);
	}

	return {
		page,

		listRepos(type: RepoType, params: ListReposParams, options: RequestOptions = {}) {
			return page<RepoSummary>(listApiPath(type) + query(params), options);
		},

		info(
			type: RepoType,
			id: string,
			{ revision, expand }: { revision?: string; expand?: string[] } = {},
			options: RequestOptions = {}
		) {
			const base = repoApiPath(type, id);
			const path = revision ? `${base}/revision/${encodeRev(revision)}` : base;
			return getJson<RepoInfo>(path + query({ expand }), options);
		},

		tree(
			type: RepoType,
			id: string,
			rev: string,
			path = '',
			params: { recursive?: boolean; expand?: boolean; limit?: number } = {},
			options: RequestOptions = {}
		) {
			const base = `${repoApiPath(type, id)}/tree/${encodeRev(rev)}`;
			const full = path ? `${base}/${encodeSegments(path)}` : base;
			return page<TreeEntry>(full + query(params), options);
		},

		refs(
			type: RepoType,
			id: string,
			{ includePrs }: { includePrs?: boolean } = {},
			options: RequestOptions = {}
		) {
			const path = `${repoApiPath(type, id)}/refs${query({ include_prs: includePrs ? 1 : undefined })}`;
			return getJson<RepoRefs>(path, options);
		},

		commits(
			type: RepoType,
			id: string,
			rev: string,
			params: { p?: number; limit?: number; expand?: string[] } = {},
			options: RequestOptions = {}
		) {
			return page<Commit>(
				`${repoApiPath(type, id)}/commits/${encodeRev(rev)}${query(params)}`,
				options
			);
		},

		// Bound patch reads so a large diff cannot exhaust browser memory.
		async patch(
			type: RepoType,
			id: string,
			base: string,
			head: string,
			{ maxBytes = 2 * 1024 * 1024 }: { maxBytes?: number } = {},
			options: RequestOptions = {}
		): Promise<TextFile> {
			const res = await request(
				`${repoApiPath(type, id)}/compare/${encodeRev(base)}..${encodeRev(head)}`,
				options,
				'text/plain, application/json'
			);
			const file = await readText(res, maxBytes);
			if (file.truncated || !res.headers.get('content-type')?.includes('json')) return file;
			try {
				const parsed = JSON.parse(file.text);
				return typeof parsed === 'string' ? { ...file, text: parsed } : file;
			} catch {
				return file;
			}
		},

		pathsInfo(
			type: RepoType,
			id: string,
			rev: string,
			paths: string[],
			{ expand }: { expand?: boolean } = {},
			options: RequestOptions = {}
		) {
			return request(
				`${repoApiPath(type, id)}/paths-info/${encodeRev(rev)}`,
				options,
				'application/json',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ paths, expand: expand ?? false })
				}
			).then((res) => res.json() as Promise<TreeEntry[]>);
		},

		whoami(options: RequestOptions = {}) {
			return getJson<WhoAmI>('/api/whoami-v2', options);
		},

		async createRepo(
			type: RepoType,
			id: string,
			{ sdk }: { sdk?: SpaceSdk } = {},
			options: RequestOptions = {}
		) {
			const { organization, name } = splitRepoId(id);
			const body = { type, name, organization, private: false, ...(type === 'space' && { sdk }) };
			await sendJson('POST', '/api/repos/create', body, options);
		},

		async deleteRepo(type: RepoType, id: string, options: RequestOptions = {}) {
			const { organization, name } = splitRepoId(id);
			await sendJson('DELETE', '/api/repos/delete', { type, name, organization }, options);
		},

		async moveRepo(type: RepoType, fromRepo: string, toRepo: string, options: RequestOptions = {}) {
			splitRepoId(fromRepo);
			splitRepoId(toRepo);
			await sendJson('POST', '/api/repos/move', { fromRepo, toRepo, type }, options);
		},

		tagsByType(type: 'model' | 'dataset', options: RequestOptions = {}) {
			return optional<TagsByType>(`/api/${type}s-tags-by-type`, options);
		},

		quicksearch(
			q: string,
			params: { limit?: number; type?: string } = {},
			options: RequestOptions = {}
		) {
			return optional<QuickSearch>(`/api/quicksearch${query({ q, ...params })}`, options);
		},

		userOverview(username: string, options: RequestOptions = {}) {
			return getJson<UserOverview>(`/api/users/${encodeURIComponent(username)}/overview`, options);
		},

		async text(
			type: RepoType,
			id: string,
			rev: string,
			path: string,
			{ maxBytes = 2 * 1024 * 1024 }: { maxBytes?: number } = {},
			options: RequestOptions = {}
		): Promise<TextFile> {
			const res = await request(
				resolvePath(type, id, rev, path),
				options,
				'text/markdown, text/plain, */*'
			);
			return readText(res, maxBytes);
		}
	};
}

export type HubClient = ReturnType<typeof createClient>;
