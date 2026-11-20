<script lang="ts">
	import RecipeCard from '$lib/components/RecipeCard.svelte';
	import { appState } from '$lib/appState.svelte.ts';

	let search = $state('');
	let ingredient = $state('');

	const matches = $derived.by(() => {
		const query = search.trim().toLowerCase();
		const ingredientQuery = ingredient.trim().toLowerCase();
		return appState.recipes.filter((recipe) => {
			if (query && !recipe.name.toLowerCase().includes(query)) return false;
			if (
				ingredientQuery &&
				!recipe.ingredients.some((i) => i.name.toLowerCase().includes(ingredientQuery))
			) {
				return false;
			}
			return true;
		});
	});

	const hasFilters = $derived(search.trim() !== '' || ingredient.trim() !== '');

	const popularIngredients = $derived.by(() => {
		const counts = new Map<string, { name: string; count: number }>();
		for (const recipe of appState.recipes) {
			for (const i of recipe.ingredients) {
				const key = i.name.trim().toLowerCase();
				if (!key) continue;
				const entry = counts.get(key) ?? { name: i.name.trim(), count: 0 };
				entry.count += 1;
				counts.set(key, entry);
			}
		}
		return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 12);
	});

	function clearFilters() {
		search = '';
		ingredient = '';
	}

	function toggleIngredient(name: string) {
		ingredient =
			ingredient.trim().toLowerCase() === name.toLowerCase() ? '' : name;
	}

	function loadSamples() {
		appState.loadSamples();
		appState.notify('Sample recipes added to your shelf');
	}
</script>

<svelte:head>
	<title>Recipes · Salt &amp; Spoon</title>
</svelte:head>

<div class="page-head">
	<h1>Recipe shelf</h1>
	<p class="page-sub">Everything you know how to make — searchable, shoppable, all yours.</p>
</div>

{#if appState.recipes.length === 0}
	<section class="empty">
		<span class="empty-emoji" aria-hidden="true">🥄</span>
		<h2>The shelf is empty</h2>
		<p>Add a recipe of your own, or borrow a few samples to see how it works.</p>
		<div class="actions">
			<a class="btn btn-primary" href="/new">Add your first recipe</a>
			<button class="btn btn-ghost" onclick={loadSamples}>Load sample recipes</button>
		</div>
	</section>
{:else}
	<div class="toolbar">
		<div class="control">
			<span class="control-icon" aria-hidden="true">🔎</span>
			<input
				type="text"
				bind:value={search}
				placeholder="Search recipes…"
				aria-label="Search recipes by name"
			/>
		</div>
		<div class="control">
			<span class="control-icon" aria-hidden="true">🧄</span>
			<input
				type="text"
				bind:value={ingredient}
				placeholder="Filter by ingredient…"
				aria-label="Filter recipes by ingredient"
			/>
		</div>
	</div>

	{#if popularIngredients.length > 0}
		<div class="filter-chip-row">
			<span>Browse by ingredient:</span>
			{#each popularIngredients as popular (popular.name)}
				<button
					class="filter-chip"
					class:on={ingredient.trim().toLowerCase() === popular.name.toLowerCase()}
					onclick={() => toggleIngredient(popular.name)}
				>
					{popular.name}
				</button>
			{/each}
		</div>
	{/if}

	<div class="results-meta">
		<span>
			{matches.length}
			{matches.length === 1 ? 'recipe' : 'recipes'}
			{hasFilters ? 'match your filters' : 'on the shelf'}
		</span>
		{#if hasFilters}
			<button class="link-btn" onclick={clearFilters}>Clear filters</button>
		{/if}
	</div>

	<div class="recipe-grid">
		{#each matches as recipe (recipe.id)}
			<RecipeCard {recipe} />
		{/each}
		{#if matches.length === 0}
			<div class="empty">
				<span class="empty-emoji" aria-hidden="true">🫙</span>
				<h2>Nothing matches</h2>
				<p>No recipe on the shelf fits “{search.trim() || ingredient.trim()}”.</p>
				<div class="actions">
					<button class="btn btn-ghost" onclick={clearFilters}>Clear filters</button>
					<a class="btn btn-primary" href="/new">Add a new recipe</a>
				</div>
			</div>
		{/if}
	</div>
{/if}
