import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ pages: 'build/app', assets: 'build/app', fallback: 'index.html' }),
		alias: { $logo: 'logo' },
		typescript: {
			config: (tsconfig) => {
				tsconfig.include.push(
					'../proxy-routes.ts',
					'../playwright.config.ts',
					'../e2e/**/*.ts',
					'../tools/**/*.ts'
				);
			}
		},
		// Emitted as a <meta> tag in the SPA shell; nginx adds the header-only frame-ancestors directive.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				// wasm-unsafe-eval: @huggingface/hub compiles its blake3 hasher to WebAssembly.
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'font-src': ['self'],
				'connect-src': [
					'self',
					'https://huggingface.co',
					'https://*.huggingface.co',
					'https://*.hf.co'
				],
				'frame-src': ['https://*.hf.space'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
