import type { ParamMatcher } from '@sveltejs/kit';

export const match = ((param) =>
	param === 'models' || param === 'datasets' || param === 'spaces') satisfies ParamMatcher;
