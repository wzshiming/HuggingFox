import type { TreeEntry } from '$lib/api/types';

export type FileKind =
	| { kind: 'markdown'; language: 'markdown' }
	| { kind: 'text'; language: string | null }
	| { kind: 'image'; mime: string }
	| { kind: 'safetensors' }
	| { kind: 'gguf' }
	| { kind: 'binary' }
	| { kind: 'unknown' };

// highlight.js language per extension; null means plain text.
const languages: Record<string, string | null> = {
	json: 'json',
	jsonl: 'json',
	py: 'python',
	pyi: 'python',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'javascript',
	ts: 'typescript',
	tsx: 'typescript',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'ini',
	ini: 'ini',
	cfg: 'ini',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	c: 'c',
	h: 'c',
	cpp: 'cpp',
	cc: 'cpp',
	cxx: 'cpp',
	hpp: 'cpp',
	cu: 'cpp',
	go: 'go',
	rs: 'rust',
	java: 'java',
	sql: 'sql',
	css: 'css',
	html: 'xml',
	htm: 'xml',
	xml: 'xml',
	txt: null,
	text: null,
	log: null,
	csv: null,
	tsv: null,
	gitattributes: null,
	gitignore: null,
	env: null,
	lock: null
};

const textNames = new Set(['license', 'readme', 'makefile', 'notice', 'authors', 'changelog']);

const images: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	avif: 'image/avif'
};

const binaries = new Set([
	'bin',
	'pt',
	'pth',
	'ckpt',
	'onnx',
	'h5',
	'msgpack',
	'npy',
	'npz',
	'pkl',
	'pickle',
	'parquet',
	'arrow',
	'zip',
	'tar',
	'gz',
	'tgz',
	'xz',
	'bz2',
	'7z',
	'mp3',
	'wav',
	'flac',
	'ogg',
	'mp4',
	'webm',
	'pdf',
	'woff',
	'woff2',
	'ttf',
	'otf',
	'tflite',
	'pb',
	'wasm',
	'exe',
	'so',
	'dylib',
	'dll',
	'model',
	'spm',
	'mlmodel',
	'pack',
	'idx',
	'sqlite',
	'db'
]);

export function fileKind(path: string): FileKind {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const lower = name.toLowerCase();
	const dot = lower.lastIndexOf('.');
	const ext = dot >= 0 ? lower.slice(dot + 1) : '';
	if (ext === 'md' || ext === 'markdown') return { kind: 'markdown', language: 'markdown' };
	if (ext === 'safetensors') return { kind: 'safetensors' };
	if (ext === 'gguf') return { kind: 'gguf' };
	if (ext in images) return { kind: 'image', mime: images[ext] };
	if (binaries.has(ext)) return { kind: 'binary' };
	if (lower === 'dockerfile') return { kind: 'text', language: 'dockerfile' };
	if (ext in languages) return { kind: 'text', language: languages[ext] };
	if (textNames.has(dot >= 0 ? lower.slice(0, dot) : lower))
		return { kind: 'text', language: null };
	return { kind: 'unknown' };
}

// Decoded bytes that were not text: NUL bytes or a high share of replacement characters.
export function looksBinary(text: string): boolean {
	const sample = text.slice(0, 8192);
	if (sample.includes('\u0000')) return true;
	let bad = 0;
	for (const char of sample) if (char === '\uFFFD') bad++;
	return bad > 0 && bad / sample.length > 0.02;
}

export function crumbs(path: string): { name: string; path: string }[] {
	if (!path) return [];
	const names = path.split('/');
	return names.map((name, i) => ({ name, path: names.slice(0, i + 1).join('/') }));
}

export function parentOf(path: string): string | null {
	if (!path) return null;
	const at = path.lastIndexOf('/');
	return at < 0 ? '' : path.slice(0, at);
}

export function sortEntries<T extends Pick<TreeEntry, 'type'>>(entries: readonly T[]): T[] {
	return [
		...entries.filter((e) => e.type === 'directory'),
		...entries.filter((e) => e.type !== 'directory')
	];
}
