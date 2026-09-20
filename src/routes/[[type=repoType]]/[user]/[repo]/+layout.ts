import { repoTypeOf } from '$lib/api/url';
import type { LayoutLoad } from './$types';

// /{user}/{repo} is a model; /datasets/... and /spaces/... carry their namespace.
export const load: LayoutLoad = ({ params }) => ({
	type: repoTypeOf(params.type),
	id: `${params.user}/${params.repo}`
});
