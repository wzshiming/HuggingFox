import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { openReady } from '../tools/reference/ready.ts';

const spa = (first: string, later = first) =>
	`<!doctype html><html><body><script>
		setTimeout(() => { document.body.innerHTML = ${JSON.stringify(first)}; }, 50);
		setTimeout(() => { document.body.innerHTML = ${JSON.stringify(later)}; }, 400);
	</script></body></html>`;
const skeleton = '<main><div aria-busy="true" style="height:1rem"></div></main>';
const table = '<main><table><tbody><tr><td>wte.weight</td></tr></tbody></table></main>';
const routes: Record<string, [number, string]> = {
	'/login': [403, '<h1>403 ERROR</h1><p>Request blocked.</p>'],
	'/blank': [200, spa('<main></main>')],
	'/loading': [200, spa(skeleton)],
	'/failed': [200, spa('<main><div role="alert">Could not load Safetensors: 500</div></main>')],
	'/settling': [200, spa(skeleton, table)]
};
const local = { ready: 'main table', timeout: 1_500 };

test.describe('capture readiness', () => {
	let server: Server;
	let base: string;

	test.beforeAll(async () => {
		server = createServer((req, res) => {
			const [status, body] = routes[req.url ?? ''] ?? [404, 'not found'];
			res.writeHead(status, { 'content-type': 'text/html' }).end(body);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	test.afterAll(async () => {
		server?.closeAllConnections();
		await new Promise((resolve) => server?.close(resolve));
	});

	test('rejects a non-success response on either side, keeping the status', async ({ page }) => {
		await expect(openReady(page, `${base}/login`)).rejects.toThrow('HTTP 403');
		await expect(openReady(page, `${base}/login`, local)).rejects.toThrow('HTTP 403');
	});

	test('rejects a local page still loading, without its content or showing an error', async ({
		page
	}) => {
		await expect(openReady(page, `${base}/loading`, local)).rejects.toThrow(/aria-busy/);
		await expect(openReady(page, `${base}/blank`, local)).rejects.toThrow(/main table/);
		await expect(openReady(page, `${base}/failed`, local)).rejects.toThrow(
			'Could not load Safetensors: 500'
		);
	});

	test('resolves once the content replaced the skeleton', async ({ page }) => {
		await expect(openReady(page, `${base}/settling`, local)).resolves.toBe(200);
		expect(await page.locator('main table').innerText()).toContain('wte.weight');
	});

	test('gates hub pages on the response only', async ({ page }) => {
		await expect(openReady(page, `${base}/loading`)).resolves.toBe(200);
	});
});
