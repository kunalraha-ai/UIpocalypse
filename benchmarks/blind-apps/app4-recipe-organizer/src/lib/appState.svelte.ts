import { browser } from '$app/environment';
import { uid } from '$lib/utils';
import type { Recipe, RecipeInput } from '$lib/types';
import { sampleRecipes } from '$lib/samples';

const STORAGE_KEY = 'recipe-organizer.v1';

interface Persisted {
	version: 1;
	recipes: Recipe[];
	selectedRecipeIds: string[];
	checkedItems: string[];
}

const emptyData = (): Persisted => ({
	version: 1,
	recipes: [],
	selectedRecipeIds: [],
	checkedItems: []
});

function isRecipe(value: unknown): value is Recipe {
	if (typeof value !== 'object' || value === null) return false;
	const r = value as Record<string, unknown>;
	return (
		typeof r.id === 'string' &&
		typeof r.name === 'string' &&
		Array.isArray(r.ingredients) &&
		Array.isArray(r.instructions)
	);
}

function loadFromStorage(): Persisted {
	if (!browser) return emptyData();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return emptyData();
		const parsed = JSON.parse(raw) as Partial<Persisted>;
		const data = emptyData();
		if (Array.isArray(parsed.recipes)) data.recipes = parsed.recipes.filter(isRecipe);
		if (Array.isArray(parsed.selectedRecipeIds))
			data.selectedRecipeIds = parsed.selectedRecipeIds.filter((x): x is string => typeof x === 'string');
		if (Array.isArray(parsed.checkedItems))
			data.checkedItems = parsed.checkedItems.filter((x): x is string => typeof x === 'string');
		return data;
	} catch {
		return emptyData();
	}
}

class AppState {
	recipes: Recipe[] = $state([]);
	/** Recipe ids that are part of the current shopping list. */
	selectedRecipeIds: string[] = $state([]);
	/** Normalized ingredient keys the shopper has already ticked off. */
	checkedItems: string[] = $state([]);
	/** Transient toast message, rendered by the root layout. */
	toast: string | null = $state(null);

	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		const data = loadFromStorage();
		this.recipes = data.recipes;
		this.selectedRecipeIds = data.selectedRecipeIds;
		this.checkedItems = data.checkedItems;
	}

	private persist() {
		if (!browser) return;
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					version: 1 as const,
					recipes: this.recipes,
					selectedRecipeIds: this.selectedRecipeIds,
					checkedItems: this.checkedItems
				} satisfies Persisted)
			);
		} catch {
			// Storage may be full or unavailable; the app keeps working in memory.
		}
	}

	addRecipe(input: RecipeInput): Recipe {
		const recipe: Recipe = {
			id: uid(),
			name: input.name,
			ingredients: input.ingredients.map((i) => ({
				id: uid(),
				quantity: i.quantity.trim(),
				name: i.name.trim()
			})),
			instructions: input.instructions.map((s) => s.trim()).filter(Boolean),
			createdAt: Date.now()
		};
		this.recipes.push(recipe);
		this.persist();
		return recipe;
	}

	deleteRecipe(id: string) {
		this.recipes = this.recipes.filter((r) => r.id !== id);
		this.deselect(id);
	}

	getRecipe(id: string): Recipe | undefined {
		return this.recipes.find((r) => r.id === id);
	}

	isSelected(id: string): boolean {
		return this.selectedRecipeIds.includes(id);
	}

	toggleSelected(id: string) {
		if (this.isSelected(id)) {
			this.selectedRecipeIds = this.selectedRecipeIds.filter((s) => s !== id);
		} else {
			this.selectedRecipeIds.push(id);
		}
		this.persist();
	}

	private deselect(id: string) {
		if (!this.isSelected(id)) return;
		this.selectedRecipeIds = this.selectedRecipeIds.filter((s) => s !== id);
		this.persist();
	}

	clearSelection() {
		this.selectedRecipeIds = [];
		this.checkedItems = [];
		this.persist();
	}

	isChecked(key: string): boolean {
		return this.checkedItems.includes(key);
	}

	toggleChecked(key: string) {
		if (this.isChecked(key)) {
			this.checkedItems = this.checkedItems.filter((k) => k !== key);
		} else {
			this.checkedItems.push(key);
		}
		this.persist();
	}

	clearChecked() {
		this.checkedItems = [];
		this.persist();
	}

	loadSamples() {
		const stamp = Date.now();
		sampleRecipes.forEach((sample, index) => {
			this.recipes.push({
				id: uid(),
				name: sample.name,
				ingredients: sample.ingredients.map((i) => ({
					id: uid(),
					quantity: i.quantity,
					name: i.name
				})),
				instructions: sample.instructions,
				createdAt: stamp - index
			});
		});
		this.persist();
	}

	notify(message: string) {
		this.toast = message;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => (this.toast = null), 2800);
	}
}

export const appState = new AppState();
