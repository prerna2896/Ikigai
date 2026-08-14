-- 0004 — mark task as complete on the log page
--
-- Users log hours against tasks (see week_tasks / hours_logged), but
-- "hours logged" isn't the same as "this task is done" — you could
-- log 2h of a 4h task and still be halfway through. Adds an explicit
-- completion timestamp so the log form can carry a small ✓ checkbox
-- next to the hours input.
--
-- Nullable + defaults to NULL so existing rows are correctly "not
-- done." Setting the column also does NOT touch hours_logged; the
-- two are independent (done ≠ hours-logged-equals-planned).

ALTER TABLE public.week_tasks
  ADD COLUMN completed_at timestamptz;

-- No index needed — the column is only read at plan-load time, always
-- alongside the rest of the row.
