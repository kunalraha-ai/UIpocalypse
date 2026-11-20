export interface Ingredient {
	id: string;
	/** Free text, e.g. "2 cups", "1/2 tsp", "a pinch" — may be empty. */
	quantity: string;
	/** Ingredient name, e.g. "all-purpose flour". */
	name: string;
}

export interface Recipe {
	id: string;
	name: string;
	ingredients: Ingredient[];
	instructions: string[];
	createdAt: number;
}

export interface RecipeInput {
	name: string;
	ingredients: { quantity: string; name: string }[];
	instructions: string[];
}

export interface ShoppingItem {
	/** Normalized ingredient name — used as identity for merging & check-off state. */
	key: string;
	/** Display name (first casing seen). */
	display: string;
	/** Combined quantity across recipes, e.g. "3 cups" — may be empty. */
	quantity: string;
	/** Names of the recipes this ingredient came from. */
	from: string[];
}
