<script lang="ts">
	import { appState } from '$lib/appState.svelte.ts';
	import { aggregateShoppingList } from '$lib/shopping';

	const items = $derived(aggregateShoppingList(appState.recipes, appState.selectedRecipeIds));
	const selectedRecipes = $derived(
		appState.recipes.filter((recipe) => appState.selectedRecipeIds.includes(recipe.id))
	);
	const checkedCount = $derived(items.filter((item) => appState.isChecked(item.key)).length);

	async function copyList() {
		const lines = [
			`Shopping list — ${selectedRecipes.length} ${
				selectedRecipes.length === 1 ? 'recipe' : 'recipes'
			}`,
			'',
			...items.map((item) => `• ${[item.quantity, item.display].filter(Boolean).join(' ')}`)
		];
		try {
			await navigator.clipboard.writeText(lines.join('\n'));
			appState.notify('Shopping list copied to your clipboard');
		} catch {
			appState.notify('Could not copy — the browser refused');
		}
	}

	function clearAll() {
		appState.clearSelection();
		appState.notify('Shopping list cleared');
	}
</script>

<svelte:head>
	<title>Shopping list · Salt &amp; Spoon</title>
</svelte:head>

<div class="page-head">
	<h1>Shopping list</h1>
	<p class="page-sub">Ingredients from every recipe you ticked — merged, totalled, and ready for the store.</p>
</div>

{#if selectedRecipes.length === 0}
	<section class="empty">
		<span class="empty-emoji" aria-hidden="true">🧺</span>
		<h2>The basket is empty</h2>
		<p>Tick “＋ List” on any recipe card and its ingredients will gather here, combined.</p>
		<div class="actions">
			<a class="btn btn-primary" href="/">Browse recipes</a>
		</div>
	</section>
{:else}
	<section class="card" aria-label="Recipes on this list">
		<h2>Recipes on this list</h2>
		<div class="chip-row">
			{#each selectedRecipes as recipe (recipe.id)}
				<span class="recipe-chip">
					<a href={`/recipes/${recipe.id}`}>{recipe.name}</a>
					<button
						class="chip-x"
						onclick={() => appState.toggleSelected(recipe.id)}
						aria-label={`Remove ${recipe.name} from the shopping list`}
					>
						✕
					</button>
				</span>
			{/each}
		</div>
		{#if checkedCount > 0}
			<p class="progress">{checkedCount} of {items.length} items checked off</p>
		{/if}
	</section>

	<section class="card" style="margin-top: 1.1rem;" aria-label="Aggregated ingredients">
		<h2>Ingredients to buy</h2>
		<ul class="shopping-items">
			{#each items as item (item.key)}
				<li>
					<label class="shopping-item" class:checked={appState.isChecked(item.key)}>
						<input
							type="checkbox"
							checked={appState.isChecked(item.key)}
							onchange={() => appState.toggleChecked(item.key)}
						/>
						<span class="item-text">
							{#if item.quantity}<strong>{item.quantity}</strong> {/if}{item.display}
						</span>
					</label>
					<span class="item-from">from {item.from.join(', ')}</span>
				</li>
			{/each}
		</ul>
	</section>

	<div class="actions shopping-actions">
		<button class="btn btn-ghost" onclick={copyList} disabled={items.length === 0}>Copy list</button>
		<button class="btn btn-ghost" onclick={() => appState.clearChecked()} disabled={checkedCount === 0}>
			Uncheck all{checkedCount > 0 ? ` (${checkedCount})` : ''}
		</button>
		<button class="btn btn-danger-ghost" onclick={clearAll}>Clear entire list</button>
	</div>
{/if}
