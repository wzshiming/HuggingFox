// Chromium ignores HTTPS_PROXY/NO_PROXY, so browser tooling passes the same variables explicitly.
// BROWSER_PROXY overrides them; credentials in the url are forwarded, never printed.
export function browserProxy() {
	const env = process.env;
	const url =
		env.BROWSER_PROXY ?? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
	if (!url) return undefined;
	const { protocol, hostname, port, username, password } = new URL(url);
	const bypass = ['localhost', '127.0.0.1', env.NO_PROXY ?? env.no_proxy].filter(Boolean).join(',');
	return {
		server: `${protocol}//${hostname}${port ? `:${port}` : ''}`,
		bypass,
		username: username ? decodeURIComponent(username) : undefined,
		password: password ? decodeURIComponent(password) : undefined
	};
}
