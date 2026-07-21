// Supabase client singleton. Only the anon (public) key is used here — it is safe
// to ship to the browser because Row-Level Security in the database governs access.
//
// If the env vars are not configured, `supabase` is null and the app runs in
// local-only mode (personal expenses in localStorage still work; group features
// are disabled). This keeps solo use working with zero backend setup.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Treat the placeholder values from .env.example as "not configured".
const isConfigured = !!url && !!anonKey && !url.includes('YOUR-PROJECT-ref') && !anonKey.includes('your-anon');

export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // completes the OAuth redirect on load
      },
    })
  : null;

// True when a real Supabase project is configured; group features gate on this.
export const cloudEnabled = () => supabase !== null;
