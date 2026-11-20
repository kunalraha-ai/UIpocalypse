import type { Habit, User } from "../types";

const USERS_KEY = "ember:users";
const SESSION_KEY = "ember:session";
const habitsKey = (email: string) => `ember:habits:${email}`;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ------------------------------- users ------------------------------- */

export function getUsers(): Record<string, User> {
  return readJSON<Record<string, User>>(USERS_KEY, {});
}

export function getUser(email: string): User | undefined {
  return getUsers()[email.toLowerCase()];
}

export function saveUser(user: User): void {
  const users = getUsers();
  users[user.email] = user;
  writeJSON(USERS_KEY, users);
}

/* ------------------------------ session ------------------------------ */

export function getSessionEmail(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setSession(email: string): void {
  localStorage.setItem(SESSION_KEY, email);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/* ------------------------------- habits ------------------------------ */

export function loadHabits(email: string): Habit[] {
  return readJSON<Habit[]>(habitsKey(email), []);
}

export function saveHabits(email: string, habits: Habit[]): void {
  writeJSON(habitsKey(email), habits);
}

/* --------------------------- password hash --------------------------- */

/** SHA-256 hex digest of `salt:password` via the Web Crypto API. */
export async function hashPassword(
  password: string,
  salt: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function newSalt(): string {
  return crypto.randomUUID();
}
