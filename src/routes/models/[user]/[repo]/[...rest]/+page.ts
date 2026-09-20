import { redirect } from '@sveltejs/kit';
import { encodeSegments } from '$lib/api/url';
import type { PageLoad } from './$types';

// Models live at the root like on the Hub; /models/{user}/{repo}[/...] is only an alias.
export const load: PageLoad = ({ params, url }) => {
	const rest = params.rest ? `/${encodeSegments(params.rest)}` : '';
	redirect(308, `/${encodeSegments(`${params.user}/${params.repo}`)}${rest}${url.search}`);
};
