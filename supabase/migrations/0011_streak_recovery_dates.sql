-- 0011 — weekly-streak recovery usage tracking
--
-- Lets a broken streak be "recovered" a limited number of times (see
-- lib/useWeekStreak.ts) — the limit needs real persisted usage
-- history, since "how many times has this been used" can't be
-- derived from WeekPlan/WeekLogEntry data the rest of the streak
-- feature already reads. Mirrors companion_disclosure_acknowledged_at's
-- own addition exactly: one column on the existing per-user settings
-- row, no new table.

ALTER TABLE public.settings
  ADD COLUMN streak_recovery_dates text[] NOT NULL DEFAULT ARRAY[]::text[];
