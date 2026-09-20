import { blobPagePath, resolvePath, type RepoType } from '$lib/api/url';

export interface CardTarget {
	type: RepoType;
	id: string;
	rev: string;
	// Folder of the markdown file; relative urls resolve from here instead of the repo root.
	dir?: string;
}

export interface CardUrl {
	url: string;
	external: boolean;
}

const scheme = /^([a-z][a-z0-9+.-]*):/i;

function decode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

// Returns the url a card attribute may keep, or null when it must be removed.
export function rewriteCardUrl(
	raw: string,
	attr: 'href' | 'src',
	target: CardTarget
): CardUrl | null {
	// Browsers ignore ascii tabs and newlines inside urls, so "java\tscript:" is a scheme.
	const value = raw.replace(/[\t\n\r]/g, '').trim();
	if (!value) return null;
	if (value.startsWith('#')) return { url: value, external: false };
	const match = scheme.exec(value);
	if (match) {
		const name = match[1].toLowerCase();
		if (name === 'http' || name === 'https') return { url: value, external: true };
		if (attr === 'href' && name === 'mailto') return { url: value, external: false };
		if (attr === 'src' && /^data:image\/(?!svg)/i.test(value))
			return { url: value, external: false };
		return null;
	}
	if (value.startsWith('//')) return { url: value, external: true };
	if (value.startsWith('/')) return { url: value, external: false };

	const [path, hash] = value.split('#', 2);
	const segments: string[] = target.dir ? target.dir.split('/').filter(Boolean) : [];
	for (const segment of path.split('?')[0].split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') segments.pop();
		else segments.push(decode(segment));
	}
	if (!segments.length) return null;
	const file = segments.join('/');
	const url =
		attr === 'src'
			? resolvePath(target.type, target.id, target.rev, file)
			: blobPagePath(target.type, target.id, target.rev, file);
	return { url: hash ? `${url}#${hash}` : url, external: false };
}
