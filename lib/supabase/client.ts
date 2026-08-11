// Supabase browser client — for use in client components ('use client').
// Session lives in cookies (shared with server client via @supabase/ssr)
// so both sides see the same auth state without extra plumbing.

import { createBrowserClient } from '@supabase/ssr';

// Singleton — creating one per render leaks event listeners.
let cached: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
