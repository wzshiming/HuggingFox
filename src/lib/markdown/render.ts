import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import { markedHighlight } from 'marked-highlight';
import markedKatex from 'marked-katex-extension';

const languages = {
	bash,
	c,
	cpp,
	css,
	diff,
	dockerfile,
	go,
	ini,
	java,
	javascript,
	json,
	markdown,
	python,
	rust,
	sql,
	typescript,
	xml,
	yaml
};
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language);
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['toml'], { languageName: 'ini' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });

const marked = new Marked(
	markedHighlight({
		emptyLangClass: 'hljs',
		langPrefix: 'hljs language-',
		highlight(code, lang) {
			if (!hljs.getLanguage(lang)) return code;
			return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
		}
	}),
	markedKatex({ throwOnError: false, output: 'html', nonStandard: true }),
	gfmHeadingId()
);

// Unsanitized html: callers must pass the result through the card sanitizer.
export function renderMarkdown(source: string): string {
	return marked.parse(source, { async: false, gfm: true });
}

// Escaped html spans, or null when the language is unknown so callers fall back to plain text.
export function highlightCode(code: string, language: string | null): string | null {
	if (!language || !hljs.getLanguage(language)) return null;
	return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
