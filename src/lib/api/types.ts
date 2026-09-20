import type { paths } from './hf-openapi';

type JsonOf<R> = R extends { content: { 'application/json': infer J } } ? J : never;
type GetOk<P extends keyof paths> = paths[P] extends { get: { responses: { 200: infer R } } }
	? JsonOf<R>
	: never;
// Fields hfd may omit even though the HF spec requires them.
type Sparse<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Derived from the checked-in HF OpenAPI subset (pnpm gen:api).
type TreeEntrySpec = GetOk<'/api/models/{namespace}/{repo}/tree/{rev}/{path}'>[number];
export type TreeEntry = TreeEntrySpec & { path: string };
export type RepoRefs = GetOk<'/api/models/{namespace}/{repo}/refs'>;
export type RefEntry = RepoRefs['branches'][number];
type CommitSpec = GetOk<'/api/models/{namespace}/{repo}/commits/{rev}'>[number];
export type Commit = Sparse<CommitSpec, 'authors' | 'title'>;
export type QuickSearch = Partial<GetOk<'/api/quicksearch'>>;
export type TagsByType = GetOk<'/api/models-tags-by-type'>;
export type TagEntry = NonNullable<TagsByType[keyof TagsByType]>[number];
type UserOverviewSpec = GetOk<'/api/users/{username}/overview'>;
export type UserOverview = Sparse<UserOverviewSpec, Exclude<keyof UserOverviewSpec, 'user'>>;
type WhoAmISpec = GetOk<'/api/whoami-v2'>;
export type WhoAmI = Sparse<WhoAmISpec, Exclude<keyof WhoAmISpec, 'name'>>;

export interface Page<T> {
	items: T[];
	next: string | null;
	total: number | null;
}

// The spec does not describe the list/info endpoints; every field a hub may omit is optional.
export interface RepoSummary {
	id: string;
	_id?: string;
	author?: string;
	sha?: string;
	private?: boolean;
	gated?: boolean | 'auto' | 'manual';
	disabled?: boolean;
	lastModified?: string;
	createdAt?: string;
	likes?: number;
	downloads?: number;
	trendingScore?: number;
	tags?: string[];
	pipeline_tag?: string;
	library_name?: string;
	description?: string;
	cardData?: Record<string, unknown>;
	sdk?: string;
	emoji?: string;
	title?: string;
	runtime?: { stage?: string; hardware?: { current?: string | null } };
}

export interface Sibling {
	rfilename: string;
	size?: number;
	blobId?: string;
	lfs?: { oid: string; size: number; pointerSize?: number };
}

export interface RepoInfo extends RepoSummary {
	modelId?: string;
	siblings?: Sibling[];
	config?: Record<string, unknown>;
	safetensors?: { total?: number; parameters?: Record<string, number> };
	usedStorage?: number;
	widgetData?: unknown[];
	spaces?: string[];
	paperswithcode_id?: string | null;
	citation?: string;
	transformersInfo?: Record<string, unknown>;
	// Spaces: public app origin plus the models and datasets the app declares.
	host?: string;
	subdomain?: string;
	models?: string[];
	datasets?: string[];
}
