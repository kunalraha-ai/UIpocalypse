// Fixture: a hardcoded live secret and a service-role key read in client-reachable
// code. Should fire: exposed-secret AND service-key-in-client.
const stripeKey = 'FAKE-STRIPE-KEY-REMOVED-FROM-HISTORY';

export const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const client = { stripeKey, svc };
