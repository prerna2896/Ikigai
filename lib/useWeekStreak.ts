'use client';

// Duolingo-style weekly streak — consecutive weeks with ANY logged
// activity, not full plan completion. A low bar on purpose: this app's
// established voice is autonomy-supportive, never guilt-driven (same
// principle already encoded in Kenji's copy rules in
// packages/insights/src/prompt.ts) — a streak that demands a fully
// completed week would punish an honest, partial week instead of
// recognizing that the person still showed up.
//
// Fully derived from existing WeekPlan/WeekLogEntry data — no new DB
// fields, no migration. Walks backward from the current week via the
// same week-start arithmetic signals.ts's sustained_underdelivery
// check already uses (see lib/weekPosition.ts), one week at a time,
// stopping at the first week with no plan or zero logged hours.

import { useEffect, useState } from 'react';
import type { Settings, WeekLogEntry } from '@ikigai/core';
import type { WeekPlanRepository, WeekLogRepository } from '@ikigai/storage';
import { findPlanForWeekStart, getCurrentWeekStartISO, priorWeekStartISO } from './weekPosition';

// Safety cap on the backward walk — one sequential repo read per week
// checked, so this also bounds worst-case latency for a very long-
// lived account. A year is already a generous streak to display.
const MAX_LOOKBACK_WEEKS = 52;

export type WeekStreakResult = {
  status: 'loading' | 'ready';
  // Consecutive weeks of logged activity, most recent first. Includes
  // the current week only once it has its own logged activity (see
  // isActiveThisWeek) — an in-progress week doesn't retroactively
  // break the streak just because today hasn't been logged yet, but
  // it also doesn't get counted until it actually has something in it.
  count: number;
  isActiveThisWeek: boolean;
};

const IDLE: WeekStreakResult = { status: 'loading', count: 0, isActiveThisWeek: false };

function weekHasLoggedActivity(logs: WeekLogEntry[]): boolean {
  return logs.some((log) => Object.values(log.taskHours).some((hours) => hours > 0));
}

export function useWeekStreak(args: {
  weekPlanRepo: WeekPlanRepository | null;
  weekLogRepo: WeekLogRepository | null;
  settings: Settings | null;
  // Bumped by callers (e.g. after logging hours) to force a recompute
  // without waiting on an unrelated dependency to change.
  refreshKey?: number;
}): WeekStreakResult {
  const { weekPlanRepo, weekLogRepo, settings, refreshKey } = args;
  const [result, setResult] = useState<WeekStreakResult>(IDLE);

  useEffect(() => {
    if (!weekPlanRepo || !weekLogRepo) {
      setResult(IDLE);
      return;
    }
    let cancelled = false;

    (async () => {
      const weekStartDay = settings?.weekStartDay ?? 'monday';
      const currentWeekStartISO = getCurrentWeekStartISO(weekStartDay);
      const allPlans = await weekPlanRepo.listWeekPlans();
      if (cancelled) return;

      const currentPlan = findPlanForWeekStart(allPlans, currentWeekStartISO);
      let isActiveThisWeek = false;
      if (currentPlan) {
        const logs = await weekLogRepo.getWeekLogs(currentPlan.id);
        if (cancelled) return;
        isActiveThisWeek = weekHasLoggedActivity(logs);
      }

      // Start counting from the current week if it's already active;
      // otherwise start from last week — an unplanned or not-yet-
      // logged current week doesn't break the streak (the week isn't
      // over), it just doesn't count toward the total yet.
      let cursor = isActiveThisWeek ? currentWeekStartISO : priorWeekStartISO(currentWeekStartISO);
      let count = 0;
      for (let i = 0; i < MAX_LOOKBACK_WEEKS; i += 1) {
        const plan = findPlanForWeekStart(allPlans, cursor);
        if (!plan) break;
        const logs = await weekLogRepo.getWeekLogs(plan.id);
        if (cancelled) return;
        if (!weekHasLoggedActivity(logs)) break;
        count += 1;
        cursor = priorWeekStartISO(cursor);
      }

      if (!cancelled) setResult({ status: 'ready', count, isActiveThisWeek });
    })();

    return () => {
      cancelled = true;
    };
  }, [weekPlanRepo, weekLogRepo, settings, refreshKey]);

  return result;
}
