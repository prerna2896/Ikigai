-- 0006 — AI Insights reaction feedback
--
-- Lightweight, write-only feedback on a generated insight (heart /
-- thumbs up / thumbs down). Deliberately NOT tied to RLS-scoped
-- per-user read access — this is for reviewing insight quality, not a
-- user-facing feature, so there's nothing for a client to read back.
-- user_id is nullable and best-effort (the client includes it when
-- signed in, omits it otherwise) so it works identically for local-only
-- and signed-in users, matching every other AI Insights design choice
-- so far. Only the server route (using the service-role key, which
-- bypasses RLS) ever writes to this table — no RLS policies are
-- defined, so no client (anon or authenticated) can read or write it
-- directly via the Supabase client libraries.

-- insight_id (the route's own crypto.randomUUID() from generation
-- time) is the primary key directly — it's already a unique per-
-- generation identifier, so a separate synthetic id would just be a
-- second source of truth for the same uniqueness. One reaction per
-- insight: resubmitting (changing your mind from thumbs-down to heart)
-- overwrites via upsert rather than accumulating rows.
CREATE TABLE public.insight_reactions (
  insight_id text PRIMARY KEY NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  week_id text NOT NULL,
  reaction text NOT NULL CHECK (reaction IN ('heart', 'thumbs_up', 'thumbs_down')),
  tone text CHECK (tone IN ('celebrate', 'attention')),
  signal_reasons text[] NOT NULL DEFAULT '{}',
  insight_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.insight_reactions ENABLE ROW LEVEL SECURITY;
