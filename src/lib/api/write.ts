import {
	commit,
	commitIter,
	HubApiError,
	type CommitOperation,
	type CommitOutput,
	type CommitProgressEvent
} from '@huggingface/hub';
import { ApiError } from './client.ts';
import type { RepoType } from './url.ts';

// Snapshot taken when the action starts, so a later sign-out or account switch cannot leak into it.
export interface WriteSession {
	hubUrl: string;
	accessToken: string;
}

export interface WriteTarget {
	type: RepoType;
	id: string;
}

export type WriteProgress = CommitProgressEvent;

export interface CommitInput {
	branch: string;
	// Tip the change was prepared against; the hub rejects the commit if the branch moved since.
	parentCommit: string;
	title: string;
	description?: string;
	signal?: AbortSignal;
}

export interface FileContent {
	path: string;
	content: Blob;
}

export type FileOperation = FileContent | { path: string; delete: true };

export interface CommitResult {
	oid: string;
}

// Plain LFS is the proven transfer here; main-thread hashing avoids worker CSP requirements.
const protocol = { useXet: false, useWebWorkers: false } as const;

function authenticatedFetch(session: WriteSession): typeof fetch {
	const origin = new URL(session.hubUrl).origin;
	const token = session.accessToken;
	return (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input), origin);
		if (url.origin !== origin) return fetch(input, init);
		const headers = new Headers(
			init?.headers ?? (input instanceof Request ? input.headers : undefined)
		);
		headers.set('authorization', `Bearer ${token}`);
		return fetch(input, { ...init, headers });
	};
}

function committed(output: CommitOutput | undefined): CommitResult {
	if (!output) throw new Error('The hub returned no commit');
	return { oid: output.commit.oid };
}

export async function commitFiles(
	session: WriteSession,
	target: WriteTarget,
	input: CommitInput & { operations: FileOperation[] }
): Promise<CommitResult> {
	input.signal?.throwIfAborted();
	const operations: CommitOperation[] = input.operations.map((op) =>
		'delete' in op
			? { operation: 'delete', path: op.path }
			: { operation: 'addOrUpdate', path: op.path, content: op.content }
	);
	const output = await commit({
		repo: { type: target.type, name: target.id },
		operations,
		title: input.title,
		description: input.description,
		branch: input.branch,
		parentCommit: input.parentCommit,
		hubUrl: session.hubUrl,
		fetch: authenticatedFetch(session),
		abortSignal: input.signal,
		...protocol
	});
	return committed(output);
}

export async function uploadFiles(
	session: WriteSession,
	target: WriteTarget,
	input: CommitInput & { files: FileContent[]; onProgress?: (event: WriteProgress) => void }
): Promise<CommitResult> {
	if (!input.files.length) throw new Error('No files selected');
	input.signal?.throwIfAborted();
	const iterator = commitIter({
		repo: { type: target.type, name: target.id },
		operations: input.files.map(({ path, content }) => ({
			operation: 'addOrUpdate',
			path,
			content
		})),
		title: input.title,
		description: input.description,
		branch: input.branch,
		parentCommit: input.parentCommit,
		hubUrl: session.hubUrl,
		fetch: authenticatedFetch(session),
		abortSignal: input.signal,
		...protocol
	});
	let step = await iterator.next();
	while (!step.done) {
		input.onProgress?.(step.value);
		step = await iterator.next();
	}
	return committed(step.value);
}

export interface WriteFailure {
	status: number | null;
	detail: string;
	aborted: boolean;
}

export function writeError(error: unknown): WriteFailure {
	const named = error as { name?: string; message?: string } | null;
	if (named?.name === 'AbortError') return { status: null, detail: 'aborted', aborted: true };
	if (error instanceof ApiError)
		return { status: error.status, detail: error.detail, aborted: false };
	if (error instanceof HubApiError) {
		const data = error.data as { error?: unknown } | undefined;
		const detail = typeof data?.error === 'string' ? data.error : error.message;
		return { status: error.statusCode, detail, aborted: false };
	}
	return { status: null, detail: String(named?.message ?? error), aborted: false };
}
