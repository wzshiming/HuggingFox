import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { hubProxy } from './proxy-routes.ts';

export default defineConfig(({ mode }) => {
	const { HUB_UPSTREAM = 'https://huggingface.co' } = loadEnv(mode, process.cwd(), 'HUB_');
	const proxy = hubProxy(HUB_UPSTREAM);

	return {
		plugins: [
			tailwindcss(),
			sveltekit(),
			paraglideVitePlugin({
				project: './project.inlang',
				outdir: './src/lib/paraglide',
				strategy: ['localStorage', 'preferredLanguage', 'baseLocale']
			})
		],
		// SvelteKit's dev middleware only serves files inside its allow list; the logo lives outside src/.
		server: { proxy, fs: { allow: ['logo'] } },
		preview: { proxy },
		test: {
			include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
			environment: 'node'
		}
	};
});
