import type { ParamMatcher } from '@sveltejs/kit';

// Prefixed repo namespaces; models live at the root without a prefix.
export const match = ((param) => param === 'datasets' || param === 'spaces') satisfies ParamMatcher;
