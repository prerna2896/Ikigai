import { defineConfig } from 'drizzle-kit';

// DATABASE_URL is the Supavisor session-mode URL for migrations only.
// The runtime app uses transaction-mode via a separate DATABASE_URL_TX
// env var (set on Vercel, not here). Migrations need session mode so
// that Postgres advisory locks work correctly.
export default defineConfig({
  schema: './packages/db/src/schema.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // Drizzle Kit generates SQL files here. Supabase CLI can also apply
  // them via `supabase db push` — either path works. We keep them in
  // supabase/migrations so the Supabase CLI can pick them up.
  verbose: true,
  strict: true,
});
