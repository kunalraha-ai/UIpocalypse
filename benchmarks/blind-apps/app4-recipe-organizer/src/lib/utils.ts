export function uid(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Canonical key for comparing ingredient names. */
export function normalizeKey(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}
