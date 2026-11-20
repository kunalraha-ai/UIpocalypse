import Stripe from 'stripe';

/**
 * Stripe integration — TEST MODE ONLY.
 *
 * The bundled key in .env.local is a PLACEHOLDER (`sk_test_…`), not a real
 * secret. Swap in your own test-mode secret key from
 * https://dashboard.stripe.com/test/apikeys to hit the real Stripe sandbox.
 * Live keys (`sk_live_…`) are refused outright by `assertTestModeKey`.
 */
export const STRIPE_SECRET_KEY =
  process.env.STRIPE_SECRET_KEY ?? 'sk_test_51PLACEHOLDERnotARealKeyReplaceMeForLocalTesting';

export function isTestKey(key: string): boolean {
  return key.startsWith('sk_test_');
}

export function assertTestModeKey(key: string): void {
  if (key.startsWith('sk_live_')) {
    throw new Error('Live Stripe keys are not allowed — this app runs in TEST mode only.');
  }
  if (!isTestKey(key)) {
    throw new Error('STRIPE_SECRET_KEY must be a test-mode key starting with "sk_test_".');
  }
}

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    assertTestModeKey(STRIPE_SECRET_KEY);
    stripeClient = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
