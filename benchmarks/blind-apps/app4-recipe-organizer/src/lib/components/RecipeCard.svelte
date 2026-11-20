<script lang="ts">
	import type { Recipe } from '$lib/types';
	import { appState } from '$lib/appState.svelte.ts';

	let { recipe }: { recipe: Recipe } = $props();

	const selected = $derived(appState.isSelected(recipe.id));
</script>

<article class="card recipe-card">
	<div class="card-top">
		<h3><a href={`/recipes/${recipe.id}`}>{recipe.name}</a></h3>
		<button
			class="pill-toggle"
			class:on={selected}
			onclick={() => appState.toggleSelected(recipe.id)}
			aria-pressed={selected}
			title={selected ? 'Remove from shopping list' : 'Add to shopping list'}
		>
			{selected ? '✓ On the list' : '＋ List'}
		</button>
	</div>
	<p class="meta">
		{recipe.ingredients.length}
		{recipe.ingredients.length === 1 ? 'ingredient' : 'ingredients'} ·
		{recipe.instructions.length}
		{recipe.instructions.length === 1 ? 'step' : 'steps'}
	</p>
	{#if recipe.ingredients.length > 0}
		<ul class="chips" aria-label="Some ingredients">
			{#each recipe.ingredients.slice(0, 4) as ingredient (ingredient.id)}
				<li>{ingredient.name}</li>
			{/each}
			{#if recipe.ingredients.length > 4}
				<li class="more">+{recipe.ingredients.length - 4} more</li>
			{/if}
		</ul>
	{/if}
	<a class="card-link" href={`/recipes/${recipe.id}`}>View recipe <span aria-hidden="true">→</span></a>
</article>
