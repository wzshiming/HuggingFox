import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import { browserProxy } from './e2e/fixtures/browser-proxy.ts';
import type { SelfhostedOptions } from './e2e/fixtures/selfhosted.ts';

// `mocked` (default, CI) intercepts the hub in the browser and proxies the rest to a local
// fixture upstream; `live` (pnpm test:live) needs HUB_UPSTREAM pointing at a real hub;
// `selfhosted` (pnpm test:selfhosted) builds and runs the embedded binary on a loopback port
// with throwaway data and a per-run token, so nothing is mocked and nothing leaves the machine.
const upstream = process.env.HUB_UPSTREAM;
const fixtureUpstream = 'http://127.0.0.1:4174';
const reuseExistingServer = !process.env.CI;
const selfhosted = process.env.SELFHOSTED === '1';
const selfhostedPort = Number(process.env.SELFHOSTED_PORT ?? 4175);
const selfhostedOrigin = `http://127.0.0.1:${selfhostedPort}`;
// Share a non-HF token across workers to exercise self-hosted credential compatibility.
process.env.SELFHOSTED_TOKEN ??= `selfhosted_${randomBytes(12).toString('hex')}`;
const selfhostedToken = process.env.SELFHOSTED_TOKEN;

export default defineConfig<SelfhostedOptions>({
	testDir: 'e2e',
	webServer: selfhosted
		? [
				{
					command: 'node e2e/fixtures/selfhosted-server.ts',
					url: `${selfhostedOrigin}/api/models`,
					reuseExistingServer: false,
					timeout: 300_000,
					// SIGTERM (not the default SIGKILL) lets the runner stop the binary and remove its build and data.
					gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
					env: { SELFHOSTED_PORT: String(selfhostedPort), SELFHOSTED_TOKEN: selfhostedToken }
				}
			]
		: [
				...(upstream
					? []
					: [{ command: 'node e2e/fixtures/upstream.ts', port: 4174, reuseExistingServer }]),
				{
					command: 'pnpm build && pnpm preview',
					port: 4173,
					reuseExistingServer,
					env: { HUB_UPSTREAM: upstream ?? fixtureUpstream }
				}
			],
	use: { baseURL: selfhosted ? selfhostedOrigin : 'http://localhost:4173' },
	projects: [
		{ name: 'mocked', testIgnore: /\/(live|selfhosted)\// },
		// Real-hub pages pull avatars and thumbnails straight from CDNs, so the browser needs the machine proxy.
		{
			name: 'live',
			testMatch: /\/live\/.*\.spec\.ts$/,
			timeout: 120_000,
			retries: 2,
			use: { proxy: browserProxy() }
		},
		{
			name: 'selfhosted',
			testMatch: /\/selfhosted\/.*\.spec\.ts$/,
			timeout: 120_000,
			use: { token: selfhostedToken }
		}
	]
});
