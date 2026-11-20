<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { appState } from '$lib/appState.svelte.ts';

	const recipe = $derived(appState.recipes.find((r) => r.id === page.params.id));
	const selected = $derived(recipe ? appState.isSelected(recipe.id) : false);

	let confirmingDelete = $state(false);
	let deleteTimer: ReturnType<typeof setTimeout> | undefined;

	function requestDelete() {
		if (!recipe) return;
		if (!confirmingDelete) {
			confirmingDelete = true;
			clearTimeout(deleteTimer);
			deleteTimer = setTimeout(() => (confirmingDelete = false), 3000);
			return;
		}
		const name = recipe.name;
		appState.deleteRecipe(recipe.id);
		appState.notify(`“${name}” removed from your shelf`);
		goto('/');
	}
</script>

<svelte:head>
	<title>{recipe ? `${recipe.name} · Salt & Spoon` : 'Recipe not found · Salt & Spoon'}</title>
</svelte:head>

{#if recipe}
	<a class="back" href="/">← Back to recipes</a>
	<div class="page-head detail-head">
		<h1>{recipe.name}</h1>
		<p class="meta">
			{recipe.ingredients.length}
			{recipe.ingredients.length === 1 ? 'ingredient' : 'ingredients'} ·
			{recipe.instructions.length}
			{recipe.instructions.length === 1 ? 'step' : 'steps'} ·
			added {new Date(recipe.createdAt).toLocaleDateString()}
		</p>
		<div class="detail-actions">
			<button
				class="btn"
				class:btn-primary={!selected}
				class:btn-soft={selected}
				onclick={() => appState.toggleSelected(recipe.id)}
			>
				{selected ? '✓ On your shopping list' : '＋ Add to shopping list'}
			</button>
			<button class="btn btn-danger-ghost" onclick={requestDelete}>
				{confirmingDelete ? 'Really delete? Click again' : 'Delete'}
			</button>
		</div>
	</div>

	<div class="detail-grid">
		<section class="card" aria-label="Ingredients">
			<h2>Ingredients</h2>
			<ul class="ingredient-list">
				{#each recipe.ingredients as ingredient (ingredient.id)}
					<li>
						{#if ingredient.quantity}<strong>{ingredient.quantity}</strong>{/if}
						<span>{ingredient.name}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="card" aria-label="Instructions">
			<h2>Instructions</h2>
			<ol class="steps">
				{#each recipe.instructions as step, index (index)}
					<li>
						<span class="step-badge">{index + 1}</span>
						<p>{step}</p>
					</li>
				{/each}
			</ol>
		</section>
	</div>
{:else}
	<section class="empty">
		<span class="empty-emoji" aria-hidden="true">🥄</span>
		<h2>That recipe isn’t on the shelf</h2>
		<p>It may have been deleted, or the link is a little stale.</p>
		<div class="actions">
			<a class="btn btn-primary" href="/">Back to recipes</a>
		</div>
	</section>
{/if}
