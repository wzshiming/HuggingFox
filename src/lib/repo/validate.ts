// Mirrors huggingface_hub's validate_repo_id: word chars, '-' and '.', 1–96 long, no '--', '..' or '.git'.
export type RepoNameError = 'empty' | 'length' | 'chars' | 'double' | 'git';

export function validateRepoName(name: string): RepoNameError | null {
	if (!name.trim()) return 'empty';
	if (name.length > 96) return 'length';
	if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name) || /[.-]$/.test(name)) return 'chars';
	if (name.includes('--') || name.includes('..')) return 'double';
	if (name.endsWith('.git')) return 'git';
	return null;
}

export type FilePathError = 'empty' | 'invalid';

// Relative, slash-separated, no empty/dot segments, no backslashes or control characters.
export function validateFilePath(path: string): FilePathError | null {
	if (!path.trim()) return 'empty';
	// eslint-disable-next-line no-control-regex
	if (/[\\\u0000-\u001f\u007f]/.test(path)) return 'invalid';
	const segments = path.split('/');
	if (segments.some((s) => s === '' || s === '.' || s === '..')) return 'invalid';
	return null;
}

export function joinPath(dir: string, name: string): string {
	return [dir, name]
		.map((part) => part.replace(/^\/+|\/+$/g, ''))
		.filter(Boolean)
		.join('/');
}
