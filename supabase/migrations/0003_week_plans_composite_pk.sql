-- week_plans.id is weekStartISO (e.g. '2026-08-10'). Under the previous
-- schema it was a global PRIMARY KEY (text), which meant only ONE user
-- could ever have a plan for a given week — the second user hit a PK
-- duplicate, ON CONFLICT DO UPDATE fired, and RLS' USING check
-- rejected the update (existing row belongs to a different user).
--
-- Fix: composite primary key (user_id, id). Each user gets their own
-- namespace for plan ids. Child tables (week_domains, week_tasks,
-- week_goals, hours_logged, week_notes) already carry user_id, so
-- their FKs upgrade to composite (user_id, week_plan_id) references.

BEGIN;

-- Drop existing child FKs that reference week_plans(id) only.
ALTER TABLE public.week_domains
  DROP CONSTRAINT IF EXISTS week_domains_week_plan_id_week_plans_id_fk;
ALTER TABLE public.week_tasks
  DROP CONSTRAINT IF EXISTS week_tasks_week_plan_id_week_plans_id_fk;
ALTER TABLE public.week_goals
  DROP CONSTRAINT IF EXISTS week_goals_week_plan_id_week_plans_id_fk;
ALTER TABLE public.hours_logged
  DROP CONSTRAINT IF EXISTS hours_logged_week_plan_id_week_plans_id_fk;
ALTER TABLE public.week_notes
  DROP CONSTRAINT IF EXISTS week_notes_week_plan_id_week_plans_id_fk;

-- Swap the PK: drop the single-column, add composite.
ALTER TABLE public.week_plans
  DROP CONSTRAINT IF EXISTS week_plans_pkey;
ALTER TABLE public.week_plans
  ADD CONSTRAINT week_plans_pkey PRIMARY KEY (user_id, id);

-- The unique (user_id, week_start_iso) index still enforces "at most
-- one plan per user per week" — no change needed.

-- Re-add child FKs as composite. ON DELETE CASCADE preserved.
ALTER TABLE public.week_domains
  ADD CONSTRAINT week_domains_user_plan_fk
  FOREIGN KEY (user_id, week_plan_id)
  REFERENCES public.week_plans(user_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.week_tasks
  ADD CONSTRAINT week_tasks_user_plan_fk
  FOREIGN KEY (user_id, week_plan_id)
  REFERENCES public.week_plans(user_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.week_goals
  ADD CONSTRAINT week_goals_user_plan_fk
  FOREIGN KEY (user_id, week_plan_id)
  REFERENCES public.week_plans(user_id, id)
  ON DELETE CASCADE;

-- hours_logged.week_plan_id is nullable (unplanned hours), so we use
-- MATCH SIMPLE (default) — the FK is only enforced when both columns
-- are non-null.
ALTER TABLE public.hours_logged
  ADD CONSTRAINT hours_logged_user_plan_fk
  FOREIGN KEY (user_id, week_plan_id)
  REFERENCES public.week_plans(user_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.week_notes
  ADD CONSTRAINT week_notes_user_plan_fk
  FOREIGN KEY (user_id, week_plan_id)
  REFERENCES public.week_plans(user_id, id)
  ON DELETE CASCADE;

COMMIT;
