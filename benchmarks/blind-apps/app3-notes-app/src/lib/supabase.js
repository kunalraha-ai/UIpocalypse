import { createClient } from '@supabase/supabase-js'

// Falls back to the local Supabase stack in this repository (started with
// `npx supabase start`, configured in supabase/config.toml), so the app works
// out of the box in local development. Override with a .env file
// (see .env.example) to point it at a hosted Supabase project.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54331'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
