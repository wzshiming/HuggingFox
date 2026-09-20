// Only a same-app path (single leading slash, no scheme or host) may be used as a login return target.
export function safeNext(candidate: string | null | undefined): string {
	if (!candidate || !/^\/(?![/\\])/.test(candidate)) return '/';
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(candidate)) return '/';
	if (candidate === '/login' || candidate.startsWith('/login?')) return '/';
	return candidate;
}

// reauth shows the token form to a signed-in user whose token a write refused.
export function loginPath(next: string, reauth = false): string {
	const params = [
		...(next === '/' ? [] : [`next=${encodeURIComponent(next)}`]),
		...(reauth ? ['reauth=1'] : [])
	];
	return params.length ? `/login?${params.join('&')}` : '/login';
}
