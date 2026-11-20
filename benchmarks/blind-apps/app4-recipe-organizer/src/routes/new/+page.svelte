<script lang="ts">
	import { goto } from '$app/navigation';
	import { appState } from '$lib/appState.svelte.ts';
	import { uid } from '$lib/utils';

	let name = $state('');

	let rows = $state([{ id: uid(), quantity: '', name: '' }]);
	let steps = $state([{ id: uid(), text: '' }]);

	let errors = $state<string[]>([]);
	let tried = $state(false);

	function addRow() {
		rows.push({ id: uid(), quantity: '', name: '' });
	}

	function removeRow(id: string) {
		rows = rows.filter((row) => row.id !== id);
		if (rows.length === 0) rows = [{ id: uid(), quantity: '', name: '' }];
	}

	function addStep() {
		steps.push({ id: uid(), text: '' });
	}

	function removeStep(id: string) {
		steps = steps.filter((step) => step.id !== id);
		if (steps.length === 0) steps = [{ id: uid(), text: '' }];
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		tried = true;

		const problems: string[] = [];
		const recipeName = name.trim();
		const ingredients = rows
			.map((row) => ({ quantity: row.quantity.trim(), name: row.name.trim() }))
			.filter((row) => row.name !== '');
		const instructions = steps.map((step) => step.text.trim()).filter(Boolean);

		if (!recipeName) problems.push('Give the recipe a name.');
		if (ingredients.length === 0) problems.push('Add at least one ingredient.');
		if (instructions.length === 0) problems.push('Add at least one instruction step.');
		errors = problems;
		if (problems.length > 0) return;

		const recipe = appState.addRecipe({ name: recipeName, ingredients, instructions });
		appState.notify(`“${recipe.name}” added to your shelf`);
		goto('/');
	}
</script>

<svelte:head>
	<title>New recipe · Salt &amp; Spoon</title>
</svelte:head>

<div class="page-head">
	<a class="back" href="/">← Back to recipes</a>
	<h1>Add a recipe</h1>
	<p class="page-sub">Written once, cooked forever. It lands on the shelf the moment you save.</p>
</div>

<form class="editor" onsubmit={submit} novalidate>
	<section class="card">
		<h2>Basics</h2>
		<label>
			<span class="hint">Recipe name</span>
			<input
				type="text"
				bind:value={name}
				placeholder="e.g. Sunday cinnamon rolls"
				maxlength={80}
			/>
		</label>
	</section>

	<section class="card">
		<h2>Ingredients</h2>
		<p class="hint">Quantities are optional — “2 cups”, “1/2 tsp”, “a pinch”, or nothing at all.</p>
		<div class="rows">
			{#each rows as row, index (row.id)}
				<div class="ingredient-row">
					<span class="row-num">{index + 1}.</span>
					<input
						type="text"
						bind:value={row.quantity}
						placeholder="2 cups"
						aria-label={`Quantity for ingredient ${index + 1}`}
					/>
					<input
						type="text"
						bind:value={row.name}
						placeholder="all-purpose flour"
						aria-label={`Name of ingredient ${index + 1}`}
					/>
					{#if rows.length > 1}
						<button
							type="button"
							class="icon-btn"
							onclick={() => removeRow(row.id)}
							aria-label={`Remove ingredient ${index + 1}`}
						>
							✕
						</button>
					{/if}
				</div>
			{/each}
		</div>
		<button type="button" class="btn btn-ghost btn-sm" onclick={addRow}>＋ Add ingredient</button>
	</section>

	<section class="card">
		<h2>Instructions</h2>
		<p class="hint">One step per entry — they come out numbered on the recipe page.</p>
		<div class="rows">
			{#each steps as step, index (step.id)}
				<div class="step-row">
					<span class="row-num">{index + 1}.</span>
					<textarea
						bind:value={step.text}
						rows="2"
						placeholder="Whisk the dry ingredients together in a large bowl."
						aria-label={`Step ${index + 1}`}
					></textarea>
					{#if steps.length > 1}
						<button
							type="button"
							class="icon-btn"
							onclick={() => removeStep(step.id)}
							aria-label={`Remove step ${index + 1}`}
						>
							✕
						</button>
					{/if}
				</div>
			{/each}
		</div>
		<button type="button" class="btn btn-ghost btn-sm" onclick={addStep}>＋ Add step</button>
	</section>

	{#if tried && errors.length > 0}
		<div class="errors" role="alert">
			{#each errors as problem (problem)}
				<p>{problem}</p>
			{/each}
		</div>
	{/if}

	<div class="actions">
		<button type="submit" class="btn btn-primary">Save recipe</button>
		<a href="/" class="btn btn-ghost">Cancel</a>
	</div>
</form>
