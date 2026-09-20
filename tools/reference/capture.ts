// Usage: pnpm capture:ref [--side=hf|local|both] [--local=http://localhost:4173] [--pages=home,login] [--all] [--dark] [--mock]
// Saves screenshots and HTML per page/side/width under reference/ (gitignored).
// --mock serves the local side from the e2e files fixture (labelled "Fixture:" data) instead of an upstream.
// The browser follows BROWSER_PROXY, else HTTPS_PROXY/HTTP_PROXY, honouring NO_PROXY (Chromium ignores these itself).
// A capture is a success only when openReady accepted the page; a failed one leaves `<base>.error.txt`
// in place of its html/png, and the run exits 1.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { browserProxy } from '../../e2e/fixtures/browser-proxy.ts';
import { mockFilesHub } from '../../e2e/fixtures/files.ts';
import { openReady } from './ready.ts';

interface Page {
	name: string;
	hf: string;
	local: string;
	pending?: string;
	// Local content the page must show (default: main); pages mount client-side, so `load` is too early.
	ready?: string;
}

const args = Object.fromEntries(
	process.argv.slice(2).map((arg) => {
		const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
		return [key, value];
	})
);
const config: { widths: number[]; pages: Page[] } = JSON.parse(
	readFileSync(new URL('./pages.json', import.meta.url), 'utf8')
);
const origins = { hf: 'https://huggingface.co', local: args.local ?? 'http://localhost:4173' };
const sides = (args.side && args.side !== 'both' ? [args.side] : ['hf', 'local']) as (
	'hf' | 'local'
)[];
const only = args.pages?.split(',');
const out = new URL('../../reference/', import.meta.url);
const ATTEMPTS = 3;

const proxy = browserProxy();
if (proxy) console.log(`browser proxy ${proxy.server} (bypass ${proxy.bypass})`);
const browser = await chromium.launch({ proxy });
let failures = 0;
for (const page of config.pages) {
	if (only && !only.includes(page.name)) continue;
	for (const side of sides) {
		if (side === 'local' && page.pending && !args.all) {
			console.log(`${page.name} local skipped (pending ${page.pending})`);
			continue;
		}
		for (const width of config.widths) {
			const dir = new URL(`${page.name}/`, out);
			mkdirSync(dir, { recursive: true });
			const base = new URL(`${side}-${width}${args.dark ? '-dark' : ''}`, dir).pathname;
			let lastError = '';
			for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
				const context = await browser.newContext({
					viewport: { width, height: 900 },
					colorScheme: args.dark ? 'dark' : 'light',
					locale: 'en-US'
				});
				const tab = await context.newPage();
				if (side === 'local' && args.mock) await mockFilesHub(tab);
				try {
					const status = await openReady(tab, origins[side] + page[side], {
						ready: side === 'local' ? (page.ready ?? 'main') : undefined
					});
					// Hub pages keep widgets polling, so idleness only annotates the capture.
					const idle = await tab
						.waitForLoadState('networkidle', { timeout: 15_000 })
						.then(() => true)
						.catch(() => false);
					writeFileSync(`${base}.html`, await tab.content());
					await tab.screenshot({ path: `${base}.png`, fullPage: true });
					const overflow = await tab.evaluate(
						() => document.documentElement.scrollWidth - document.documentElement.clientWidth
					);
					console.log(
						`${page.name} ${side} ${width} → ${status}${overflow > 0 ? ` OVERFLOW ${overflow}px` : ''}${idle ? '' : ' (network never idle)'}${attempt > 1 ? ` (attempt ${attempt})` : ''}`
					);
					lastError = '';
					rmSync(`${base}.error.txt`, { force: true });
					await context.close();
					break;
				} catch (error) {
					lastError = String(error);
				}
				await context.close();
			}
			if (lastError) {
				failures++;
				for (const ext of ['html', 'png']) rmSync(`${base}.${ext}`, { force: true });
				writeFileSync(`${base}.error.txt`, lastError);
				console.log(`${page.name} ${side} ${width} failed: ${lastError.split('\n')[0]}`);
			}
		}
	}
}
await browser.close();
if (failures) {
	console.log(`${failures} capture(s) failed`);
	process.exit(1);
}
