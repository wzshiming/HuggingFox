// Loads a page for capture and fails on anything but a fully rendered one: a non-2xx response, and
// for local pages (mounted client-side, so `load` precedes their content) a missing `ready` element,
// a visible loading skeleton (aria-busy) or a visible error alert.
import type { Page } from '@playwright/test';

export async function openReady(
	tab: Page,
	url: string,
	{ ready, timeout = 30_000 }: { ready?: string; timeout?: number } = {}
): Promise<number> {
	const response = await tab.goto(url, { waitUntil: 'load', timeout: 45_000 });
	const status = response?.status() ?? 0;
	if (!response?.ok()) throw new Error(`HTTP ${status}`);
	if (!ready) return status;
	const state = await tab
		.waitForFunction(
			(ready) => {
				const shown = (selector: string) =>
					[...document.querySelectorAll<HTMLElement>(selector)].filter((el) =>
						el.checkVisibility()
					);
				const alert = shown('[role="alert"]')[0];
				if (alert) return `error shown: ${alert.innerText.trim()}`;
				return shown(ready).length && !shown('[aria-busy="true"]').length ? 'ready' : '';
			},
			ready,
			{ timeout }
		)
		.then((handle) => handle.jsonValue())
		.catch((error) => `${ready} not ready without aria-busy within ${timeout}ms: ${error}`);
	if (state !== 'ready') throw new Error(state);
	return status;
}
