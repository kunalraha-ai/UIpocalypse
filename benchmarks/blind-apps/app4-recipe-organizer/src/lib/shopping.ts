import type { Recipe, ShoppingItem } from '$lib/types';
import { normalizeKey } from '$lib/utils';

/**
 * Combines quantity strings when possible.
 * "2 cups" + "1 cup"  -> "3 cups"
 * "1 1/2" + "2"       -> "3.5"
 * "to taste" + "2 oz" -> "to taste, 2 oz"
 */

const NUMBER = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)`;

function toNumber(token: string): number | null {
	let total = 0;
	for (const part of token.split(/\s+/)) {
		const [num, den] = part.split('/');
		const x = Number(num);
		if (!Number.isFinite(x)) return null;
		const y = den === undefined ? 1 : Number(den);
		if (!Number.isFinite(y) || y === 0) return null;
		total += x / y;
	}
	return total;
}

function parseQuantity(text: string): { value: number; unit: string } | null {
	const t = text.trim().toLowerCase();
	const match = t.match(new RegExp(`^(${NUMBER})(?:\\s+(.*))?$`));
	if (!match) return null;
	const value = toNumber(match[1]);
	if (value === null) return null;
	return { value, unit: (match[2] ?? '').trim() };
}

function formatNumber(n: number): string {
	const rounded = Math.round(n * 100) / 100;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '');
}

/** Treat "cup" and "cups" as the same unit, "clove" and "cloves" too… */
const foldUnit = (unit: string) => (unit.endsWith('s') ? unit.slice(0, -1) : unit);

function combineQuantities(quantities: string[]): string {
	if (quantities.length === 0) return '';
	if (quantities.length === 1) return quantities[0];
	const parsed = quantities.map(parseQuantity);
	if (parsed.every((p): p is { value: number; unit: string } => p !== null)) {
		if (new Set(parsed.map((p) => foldUnit(p.unit))).size === 1) {
			const total = parsed.reduce((sum, p) => sum + p.value, 0);
			const unit = parsed[0].unit;
			return unit ? `${formatNumber(total)} ${unit}` : formatNumber(total);
		}
	}
	return quantities.join(', ');
}

type AccruedItem = ShoppingItem & { raw: string[] };

/**
 * Merges the ingredients of the selected recipes into one shopping list:
 * same ingredients are combined (quantities summed when parseable),
 * each entry remembers which recipes it came from.
 */
export function aggregateShoppingList(recipes: Recipe[], selectedIds: string[]): ShoppingItem[] {
	const byKey = new Map<string, AccruedItem>();

	for (const recipe of recipes) {
		if (!selectedIds.includes(recipe.id)) continue;
		for (const ingredient of recipe.ingredients) {
			const name = ingredient.name.trim();
			if (!name) continue;
			const key = normalizeKey(name);
			if (!key) continue;

			let item = byKey.get(key);
			if (!item) {
				item = { key, display: name, quantity: '', from: [], raw: [] };
				byKey.set(key, item);
			}
			if (!item.from.includes(recipe.name)) item.from.push(recipe.name);
			const quantity = ingredient.quantity.trim();
			if (quantity) item.raw.push(quantity);
		}
	}

	return [...byKey.values()]
		.map(({ raw, ...item }) => ({ ...item, quantity: combineQuantities(raw) }))
		.sort((a, b) => a.display.localeCompare(b.display));
}
