<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import type { Snippet } from 'svelte';
	import { appState } from '$lib/appState.svelte.ts';

	let { children }: { children: Snippet } = $props();
</script>

<div class="app">
	<header class="site-header">
		<div class="container header-inner">
			<a href="/" class="brand">
				<span class="brand-mark" aria-hidden="true">🍳</span>
				<span class="brand-name">
					Salt &amp; Spoon
					<span class="brand-tag">recipe organizer</span>
				</span>
			</a>
			<nav class="site-nav" aria-label="Main">
				<a href="/" class:active={page.url.pathname === '/'}>Recipes</a>
				<a
					href="/shopping"
					class:active={page.url.pathname.startsWith('/shopping')}
				>
					Shopping list
					{#if appState.selectedRecipeIds.length > 0}
						<span class="badge">{appState.selectedRecipeIds.length}</span>
					{/if}
				</a>
				<a href="/new" class="btn btn-primary btn-sm">＋ New recipe</a>
			</nav>
		</div>
	</header>

	<main class="container">
		{@render children()}
	</main>

	<footer class="site-footer container">
		<p>Everything is saved in your browser — no account, no cloud, no crumbs lost.</p>
	</footer>

	{#if appState.toast}
		<div class="toast" role="status" transition:fly={{ y: 10, duration: 180 }}>
			{appState.toast}
		</div>
	{/if}
</div>
