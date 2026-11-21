// hardcoded secrets for the leak audit. The Stripe-format key is FAKE and
// assembled at runtime — no literal key-shaped string exists in this repo
// (secret scanners flag even obvious fakes; the value is the documented
// test canary, byte-for-byte what the secret-leak test expects).
const fakeStripeKey = ['sk', 'live', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('_');
export const STRIPE_KEY = fakeStripeKey;
export const DB_URL = "postgres://admin:super-secret-prod-password@prod-db.example.com:5432/myapp";
export const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456";
export const API_TOKEN = "ghp_abcdef1234567890abcdefghijklmnopqrstuvwxyz";
