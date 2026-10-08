-- 0007 — grant service_role access to insight_reactions
--
-- 0001_enable_rls.sql granted service_role ALL on every table that
-- existed at the time via a one-off loop; insight_reactions (added in
-- 0006) postdates that loop and never got the grant, so the
-- service-role client in app/api/insights/reaction/route.ts got
-- "permission denied for table insight_reactions" despite RLS being a
-- non-issue (service_role bypasses RLS — this was a plain GRANT gap).

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.insight_reactions TO service_role;
