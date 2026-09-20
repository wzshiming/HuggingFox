import parseDiff from 'parse-diff';

export interface DiffLine {
	type: 'add' | 'del' | 'context' | 'meta';
	oldNo: number | null;
	newNo: number | null;
	text: string;
}

export interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

export interface DiffFile {
	path: string;
	oldPath: string | null;
	status: 'added' | 'deleted' | 'renamed' | 'modified';
	binary: boolean;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

export interface Patch {
	files: DiffFile[];
	additions: number;
	deletions: number;
}

const binaryMarker = /^(?:Binary files .* differ|GIT binary patch)$/m;

function toLine(change: parseDiff.Change): DiffLine {
	const text = change.content.slice(1);
	if (change.content.startsWith('\\')) {
		return { type: 'meta', oldNo: null, newNo: null, text: change.content };
	}
	switch (change.type) {
		case 'add':
			return { type: 'add', oldNo: null, newNo: change.ln, text };
		case 'del':
			return { type: 'del', oldNo: change.ln, newNo: null, text };
		default:
			return { type: 'context', oldNo: change.ln1, newNo: change.ln2, text };
	}
}

// Unified git patch to a view model; the parser gives structure, binary markers come from the raw sections.
export function parsePatch(text: string): Patch {
	const parsed = parseDiff(text);
	// One section per `diff --git` header; only trusted for binary flags when the counts agree.
	const sections = text.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff --git '));
	const files = parsed.map((file, i): DiffFile => {
		const from = file.from && file.from !== '/dev/null' ? file.from : null;
		const to = file.to && file.to !== '/dev/null' ? file.to : null;
		const path = to ?? from ?? '';
		const status = file.new
			? 'added'
			: file.deleted
				? 'deleted'
				: from && to && from !== to
					? 'renamed'
					: 'modified';
		return {
			path,
			oldPath: status === 'renamed' ? from : null,
			status,
			binary: sections.length === parsed.length && binaryMarker.test(sections[i]),
			additions: file.additions,
			deletions: file.deletions,
			hunks: file.chunks.map((chunk) => ({
				header: chunk.content,
				lines: chunk.changes.map(toLine)
			}))
		};
	});
	return {
		files,
		additions: files.reduce((n, f) => n + f.additions, 0),
		deletions: files.reduce((n, f) => n + f.deletions, 0)
	};
}
