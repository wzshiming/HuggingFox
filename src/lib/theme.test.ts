import { describe, expect, it } from 'vitest';
import { createTheme, THEME_KEY } from './theme.svelte.ts';

function memoryStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k)
	};
}

describe('theme', () => {
	it('follows the system preference by default', () => {
		const theme = createTheme({ storage: memoryStorage(), prefersDark: () => true });
		expect(theme.value).toBe('system');
		expect(theme.dark).toBe(true);
		const light = createTheme({ storage: memoryStorage(), prefersDark: () => false });
		expect(light.dark).toBe(false);
	});

	it('persists an explicit choice and clears it when back on system', () => {
		const storage = memoryStorage();
		const theme = createTheme({ storage, prefersDark: () => false });
		theme.set('dark');
		expect(theme.dark).toBe(true);
		expect(storage.getItem(THEME_KEY)).toBe('dark');
		theme.set('system');
		expect(theme.dark).toBe(false);
		expect(storage.getItem(THEME_KEY)).toBe(null);
	});

	it('restores a stored choice and ignores garbage', () => {
		expect(
			createTheme({ storage: memoryStorage({ [THEME_KEY]: 'light' }), prefersDark: () => true })
				.dark
		).toBe(false);
		expect(
			createTheme({ storage: memoryStorage({ [THEME_KEY]: 'blue' }), prefersDark: () => true })
				.value
		).toBe('system');
	});

	it('cycles light, dark, system', () => {
		const theme = createTheme({ storage: memoryStorage(), prefersDark: () => false });
		theme.cycle();
		expect(theme.value).toBe('light');
		theme.cycle();
		expect(theme.value).toBe('dark');
		theme.cycle();
		expect(theme.value).toBe('system');
	});
});
