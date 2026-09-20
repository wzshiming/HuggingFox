import { parse } from 'yaml';

export interface Frontmatter {
	data: Record<string, unknown> | null;
	body: string;
	error?: string;
}

const fence = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): Frontmatter {
	const match = fence.exec(text);
	if (!match) return { data: null, body: text.replace(/^\uFEFF/, '') };
	const body = text.slice(match[0].length);
	try {
		const data = parse(match[1] ?? '', { uniqueKeys: false, logLevel: 'error' }) ?? {};
		if (typeof data !== 'object' || Array.isArray(data)) return { data: null, body };
		return { data, body };
	} catch (error) {
		return { data: null, body, error: String((error as Error).message ?? error) };
	}
}
