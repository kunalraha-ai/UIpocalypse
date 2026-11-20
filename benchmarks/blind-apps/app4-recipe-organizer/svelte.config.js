import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// All components use Svelte 5 runes — never let $state be read as a store.
		runes: true
	},
	kit: {
		// Pure client-side app (localStorage) — ship a single-page fallback.
		adapter: adapter({
			fallback: 'index.html'
		})
	}
};

export default config;
