import { ProxyAgent } from 'proxy-agent';
import type { ProxyOptions } from 'vite';

// Shared by the Vite dev/preview proxy and (as a literal, checked by tests) the nginx template.
// Matches request URLs (path plus optional query string) that belong to the hub, not the SPA.
const boundary = '(?:[/?]|$)';
const repo = '/(?:(?:datasets|spaces)/)?[^/?]+(?:/[^/?]+)?';

export const proxyRoutePatterns: readonly string[] = [
	`/api${boundary}`,
	`${repo}/resolve/`,
	`${repo}\\.git${boundary}`,
	`${repo}/(?:info/(?:refs|lfs)|git-upload-pack|git-receive-pack)${boundary}`,
	`/(?:objects|v1|v2|shards|reconstructions|xet-bridge|internal)${boundary}`,
	// Generated user avatars come back from the hub as relative /avatars/<hash>.svg urls.
	`/avatars/[^/?]+\\.svg(?:\\?|$)`
];

export const proxyRouteRegexSource = `^(?:${proxyRoutePatterns.join('|')})`;

const proxyRouteRegex = new RegExp(proxyRouteRegexSource);

export function isHubRequest(url: string): boolean {
	return proxyRouteRegex.test(url);
}

export function hubProxy(upstream: string): Record<string, ProxyOptions> {
	return {
		[proxyRouteRegexSource]: {
			target: upstream,
			agent: new ProxyAgent(),
			changeOrigin: true,
			secure: true,
			xfwd: true,
			autoRewrite: true,
			protocolRewrite: 'http'
		}
	};
}
