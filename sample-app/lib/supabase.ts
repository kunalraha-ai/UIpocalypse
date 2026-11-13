import { createClient } from '@supabase/supabase-js';

// Stack-detection fixture: this is where the app would talk to Supabase in a
// real deployment. Phase 0 uses the mock in lib/store.ts instead; swap the
// data access calls over when running against a local Supabase stack.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'local-anon-key-placeholder',
);
