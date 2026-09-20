import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProxyAgent } from 'proxy-agent';
import { describe, expect, it } from 'vitest';
import { hubProxy, isHubRequest, proxyRouteRegexSource } from '../proxy-routes.ts';

const proxied = [
	'/api',
	'/api/',
	'/api/models?search=bert',
	'/api/models/user/repo/tree/main/dir%2Fsub?recursive=1',
	'/api/whoami-v2',
	'/user/repo/resolve/main/config.json',
	'/gpt2/resolve/main/config.json',
	'/user/repo/resolve/refs%2Fpr%2F1/model.safetensors?download=true',
	'/datasets/user/repo/resolve/refs%2Fconvert%2Fparquet/data/train.parquet',
	'/datasets/squad/resolve/main/README.md',
	'/spaces/user/app/resolve/main/app.py',
	'/user/repo.git/info/refs?service=git-upload-pack',
	'/user/repo.git/git-upload-pack',
	'/user/repo.git/git-receive-pack',
	'/user/repo.git/info/lfs/objects/batch',
	'/user/repo.git',
	'/repo.git/info/refs',
	'/datasets/user/repo.git/info/lfs/objects/batch',
	'/user/repo/info/refs?service=git-upload-pack',
	'/user/repo/git-upload-pack',
	'/user/repo/git-receive-pack',
	'/user/repo/info/lfs/objects/batch',
	'/user/repo/info/lfs/locks/verify',
	'/datasets/user/repo/info/refs',
	'/datasets/user/repo/info/lfs/objects/batch',
	'/objects/0123abcd',
	'/objects?x=1',
	'/v1/xorbs/default/abc',
	'/v1/reconstructions/abc',
	'/v2/chunks',
	'/shards/abc',
	'/reconstructions/abc',
	'/xet-bridge/abc',
	'/internal/gc/prune',
	'/avatars/a52dc308f7ed3d39aa5f2d6ee4ef8884.svg',
	'/avatars/a52dc308f7ed3d39aa5f2d6ee4ef8884.svg?v=1'
];

const spa = [
	'/',
	'/models',
	'/models?search=bert',
	'/datasets',
	'/spaces',
	'/user/repo',
	'/user/repo/',
	'/user/repo/tree/main',
	'/user/repo/tree/main/resolve/x',
	'/user/repo/tree/info/refs',
	'/user/repo/blob/main/info/lfs',
	'/user/repo/blob/main/README.md',
	'/user/repo/blob/main/x.git',
	'/datasets/user/repo/blob/main/data.csv',
	'/user/repo.github',
	'/apiary',
	'/api-docs',
	'/objects-demo',
	'/v1beta/x',
	'/v10/x',
	'/internal-tools',
	'/shardsx',
	'/login',
	'/settings/tokens',
	'/_app/immutable/entry/start.js',
	'/favicon.svg',
	'/avatars',
	'/avatars/some-repo',
	'/avatars/logo.png',
	'/avatars/x.svg/tree/main'
];

describe('isHubRequest', () => {
	it.each(proxied)('proxies %s', (url) => {
		expect(isHubRequest(url)).toBe(true);
	});

	it.each(spa)('leaves %s to the SPA', (url) => {
		expect(isHubRequest(url)).toBe(false);
	});
});

describe('hubProxy', () => {
	it('uses the shared regex as a single Vite proxy entry', () => {
		const table = hubProxy('https://huggingface.co');
		expect(Object.keys(table)).toEqual([proxyRouteRegexSource]);
		expect(proxyRouteRegexSource.startsWith('^')).toBe(true);
		expect(table[proxyRouteRegexSource]).toMatchObject({
			target: 'https://huggingface.co',
			changeOrigin: true,
			secure: true
		});
	});

	it('uses an environment-aware agent for upstream requests', () => {
		const options = hubProxy('https://huggingface.co')[proxyRouteRegexSource];
		expect(options.agent).toBeInstanceOf(ProxyAgent);
	});
});

describe('nginx template', () => {
	it('uses the same regex for its hub location', () => {
		const template = readFileSync(
			new URL('../deploy/nginx.conf.template', import.meta.url),
			'utf8'
		);
		expect(template).toContain(`location ~ "${proxyRouteRegexSource}" {`);
	});
});

describe('nginx upstream validation', () => {
	const script = fileURLToPath(new URL('../deploy/15-hub-upstream.envsh', import.meta.url));

	it.each([
		'http://127.0.0.1;\nreturn\t200\tINJECTED',
		'http://hfd\ninvalid',
		'http://$http_x_target',
		'http://hfd:ignored:8080',
		'http://hfd:',
		'http://hfd:0',
		'http://hfd:65536',
		'http://-hfd',
		'http://hfd..local',
		'http://[localhost]:8080',
		'http://user@hfd:8080'
	])('rejects unsafe upstream %s', (upstream) => {
		const result = spawnSync('sh', [script], {
			env: { ...process.env, HUB_UPSTREAM: upstream },
			encoding: 'utf8'
		});
		expect(result.status).toBe(1);
	});

	it.each([
		'http://hfd:8080',
		'https://huggingface.co:443/',
		'http://127.0.0.1:8080',
		'http://[::1]:8080',
		'https://[2001:db8::1]'
	])('accepts upstream %s', (upstream) => {
		const result = spawnSync('sh', [script], {
			env: { ...process.env, HUB_UPSTREAM: upstream },
			encoding: 'utf8'
		});
		expect(result.status, result.stderr).toBe(0);
	});
});
