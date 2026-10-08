-- 0010 — Kenji companion one-time disclosure acknowledgment
--
-- Tracked on settings (mirrors ai_insights_enabled's shape from 0005)
-- so it syncs across devices via the same repository path, rather than
-- being local-only. Null until acknowledged; local-only (Dexie) users
-- never reach /companion (signed-in gate), so this is simply always
-- null for them.

ALTER TABLE public.settings
  ADD COLUMN companion_disclosure_acknowledged_at timestamptz;

-- No index needed — read only alongside the rest of the settings row.
