-- 0005 — AI Insights opt-in flag
--
-- AI Insights (Insights tab) sends a client-computed weekly metrics
-- summary to an LLM provider to generate a short personalized
-- observation. Nothing is ever sent anywhere unless the user has
-- explicitly turned this on in Settings — off by default so existing
-- rows are correctly "opted out."

ALTER TABLE public.settings
  ADD COLUMN ai_insights_enabled boolean NOT NULL DEFAULT false;

-- No index needed — read only alongside the rest of the settings row.
