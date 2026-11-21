'use client';

// Fixture: a hardcoded live secret and a service-role key read in a
// 'use client' module — both must fire. The key is deliberately FAKE and
// kept SHORT: long enough for the analyzer's exposed-secret pattern
// (sk_live_[A-Za-z0-9]{10,}) to catch, short and obviously-synthetic so
// hosted secret scanners do not flag the repo.
const stripeKey = 'sk_live_51MockedOut';

export const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const client = { stripeKey, svc };
