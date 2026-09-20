import DOMPurify from 'dompurify';
import { rewriteCardUrl, type CardTarget } from './links.ts';

const urlAttrs: Record<string, 'href' | 'src'> = { href: 'href', src: 'src', poster: 'src' };

export type CardSanitizer = (html: string, target: CardTarget) => string;

export function createCardSanitizer(win: Window & typeof globalThis = window): CardSanitizer {
	const purify = DOMPurify(win);
	let target: CardTarget;

	purify.addHook('uponSanitizeAttribute', (_node, data) => {
		if (data.attrName === 'srcset') {
			data.keepAttr = false;
			return;
		}
		const kind = urlAttrs[data.attrName];
		if (!kind) return;
		const rewritten = rewriteCardUrl(data.attrValue, kind, target);
		if (rewritten) data.attrValue = rewritten.url;
		else data.keepAttr = false;
	});

	purify.addHook('afterSanitizeAttributes', (node) => {
		if (node.nodeName === 'A') {
			const href = node.getAttribute('href') ?? '';
			if (/^(?:https?:)?\/\//i.test(href)) {
				node.removeAttribute('rel');
				node.setAttribute('target', '_blank');
				node.setAttribute('rel', 'noopener noreferrer');
			}
		} else if (node.nodeName === 'INPUT') {
			// Only gfm task-list checkboxes survive, and never as live controls.
			if (node.getAttribute('type') !== 'checkbox') node.remove();
			else node.setAttribute('disabled', '');
		}
	});

	return (html, next) => {
		target = next;
		return purify.sanitize(html, {
			FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option'],
			USE_PROFILES: { html: true, svg: true, svgFilters: true }
		});
	};
}
