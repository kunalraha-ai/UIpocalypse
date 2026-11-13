'use client';

// Fixture: a hardcoded live secret and a service-role key read in a
// 'use client' module — both must fire.
const stripeKey = 'FAKE-STRIPE-KEY-REMOVED-FROM-HISTORY';

export const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const client = { stripeKey, svc };
