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
// fields, no migration. Runs in TopNav (every page), so reads for the
// lookback window are fetched in parallel, not one week at a time.

import { useEffect, useState } from 'react';
import type { Settings, WeekLogEntry } from '@ikigai/core';
import type { WeekPlanRepository, WeekLogRepository } from '@ikigai/storage';
import { findPlanForWeekStart, getCurrentWeekStartISO, priorWeekStartISO } from './weekPosition';

// How far back to look. A streak longer than this shows as capped at
// this number rather than its true length — a deliberate v1 trade:
// most streaks are short, and scanning further would mean more
// parallel reads on every page load (this hook runs in TopNav, not
// just /insights). ~4 months is generous for that trade.
const WINDOW_WEEKS = 16;
// How many of the most recent weeks to expose for the mini
// calendar-strip visualization in the detail popover.
const RECENT_WEEKS_FOR_DISPLAY = 8;
// A break only offers "recovery" if it happened this recently —
// bounded so recovery means "you had a recent slip," not "go pad
// your streak with something from 3 months ago."
const RECOVERY_WINDOW_WEEKS = 3;
// How many recoveries are allowed within a rolling window — a real
// limit, not unlimited, same spirit as Duolingo's streak freezes
// being a finite resource rather than an always-available undo.
// Assumption, not asked for specifically: 1 per rolling 30 days. A
// per-use-list (not a counter + reset-date pair) means old uses just
// age out on their own — nothing has to notice "the period ended" and
// reset anything.
export const RECOVERY_LIMIT = 1;
const RECOVERY_LIMIT_WINDOW_DAYS = 30;

export type RiskLevel =
  | 'none' // no streak yet
  | 'safe' // this week already has logged activity
  | 'pending' // no activity yet this week, but there's still time
  | 'urgent'; // no activity yet, and the week is about to end

export type WeekSummary = { weekStartISO: string; active: boolean };

export type WeekStreakResult = {
  status: 'loading' | 'ready';
  // Consecutive weeks of logged activity, most recent first. Includes
  // the current week only once it has its own logged activity — an
  // in-progress week doesn't retroactively break the streak just
  // because today hasn't been logged yet, but it also doesn't get
  // counted until it actually has something in it.
  count: number;
  isActiveThisWeek: boolean;
  daysLeftInWeek: number;
  riskLevel: RiskLevel;
  // Longest run found within the lookback window — not necessarily
  // the all-time longest if a streak predates WINDOW_WEEKS.
  longestStreak: number;
  // Oldest-first, for a calendar-strip style visualization.
  recentWeeks: WeekSummary[];
  // The single most recent week that broke the current streak, if
  // it's within RECOVERY_WINDOW_WEEKS and there's genuine streak
  // history before it (not just "never started"). Log any hours for
  // this week (e.g. via its /week/<id> page) and the streak heals on
  // its own — no special "recover" write path needed, the normal
  // computation just stops breaking there next time.
  recoverable: WeekSummary | null;
  // How many recoveries are still available within the rolling
  // window — 0 means recoverable (if set) can be shown but not acted
  // on until nextRecoveryAvailableAt.
  recoveryUsesRemaining: number;
  // ISO date the next recovery use becomes available again, once the
  // oldest use blocking the current window ages out. Null when a use
  // is available right now (or there's nothing to recover anyway).
  nextRecoveryAvailableAt: string | null;
};

const IDLE: WeekStreakResult = {
  status: 'loading',
  count: 0,
  isActiveThisWeek: false,
  daysLeftInWeek: 0,
  riskLevel: 'none',
  longestStreak: 0,
  recentWeeks: [],
  recoverable: null,
  recoveryUsesRemaining: RECOVERY_LIMIT,
  nextRecoveryAvailableAt: null,
};

export function computeRecoveryAvailability(
  recoveryDates: string[] | undefined,
  now: Date,
): { recoveryUsesRemaining: number; nextRecoveryAvailableAt: string | null } {
  const windowMs = RECOVERY_LIMIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  const withinWindow = (recoveryDates ?? [])
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t) && t > cutoff)
    .sort((a, b) => a - b);

  const remaining = Math.max(0, RECOVERY_LIMIT - withinWindow.length);
  if (remaining > 0) {
    return { recoveryUsesRemaining: remaining, nextRecoveryAvailableAt: null };
  }
  // At the limit — the next slot opens when the OLDEST use inside the
  // window ages past it.
  const oldestBlocking = withinWindow[0];
  const nextAvailable = new Date(oldestBlocking + windowMs).toISOString();
  return { recoveryUsesRemaining: 0, nextRecoveryAvailableAt: nextAvailable };
}

/**
 * Records a streak-recovery use and returns the updated Settings —
 * call right when the person commits to recovering (clicking the
 * "Recover streak" button), not conditionally on whether they
 * actually go log hours afterward. A standalone function rather than
 * something the hook itself does, since it's a write (needs
 * settingsRepo), while the hook is otherwise read-only derived state.
 * Caller is responsible for persisting via settingsRepo.saveSettings
 * and triggering a recompute (e.g. via useBumpSync()).
 */
export function recordStreakRecoveryUse(settings: Settings, now: Date = new Date()): Settings {
  const dates = [...(settings.streakRecoveryDates ?? []), now.toISOString()];
  // Matches the schema's own cap — trim the oldest first if this ever
  // somehow grows unbounded (it shouldn't, at 1 per 30 days, but
  // defensive rather than relying on that holding forever).
  const trimmed = dates.length > 200 ? dates.slice(dates.length - 200) : dates;
  return { ...settings, streakRecoveryDates: trimmed };
}

function weekHasLoggedActivity(logs: WeekLogEntry[]): boolean {
  return logs.some((log) => Object.values(log.taskHours).some((hours) => hours > 0));
}

function computeDaysLeftInWeek(weekStartISO: string, today: Date): number {
  const start = new Date(`${weekStartISO}T00:00:00`);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const elapsedDays = Math.round((todayMidnight.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, 6 - elapsedDays);
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
      const now = new Date();
      const currentWeekStartISO = getCurrentWeekStartISO(weekStartDay, now);
      const allPlans = await weekPlanRepo.listWeekPlans();
      if (cancelled) return;

      // Walk backward building the list of week-start dates in the
      // window, newest first.
      const weekStartISOs: string[] = [];
      let cursor = currentWeekStartISO;
      for (let i = 0; i < WINDOW_WEEKS; i += 1) {
        weekStartISOs.push(cursor);
        cursor = priorWeekStartISO(cursor);
      }

      const plansByWeek = new Map(weekStartISOs.map((iso) => [iso, findPlanForWeekStart(allPlans, iso)]));
      const plannedWeeks = weekStartISOs.filter((iso) => plansByWeek.get(iso));

      // Fetch logs for every planned week in parallel — this hook now
      // runs in TopNav (every page), so a sequential N-request
      // waterfall would be a real, visible latency cost for
      // signed-in/cloud users.
      const logEntries = await Promise.all(
        plannedWeeks.map(async (iso) => {
          const plan = plansByWeek.get(iso)!;
          const logs = await weekLogRepo.getWeekLogs(plan.id);
          return [iso, logs] as const;
        }),
      );
      if (cancelled) return;
      const logsByWeek = new Map(logEntries);

      const weeks: WeekSummary[] = weekStartISOs.map((iso) => ({
        weekStartISO: iso,
        active: logsByWeek.has(iso) ? weekHasLoggedActivity(logsByWeek.get(iso)!) : false,
      }));

      const isActiveThisWeek = weeks[0]?.active ?? false;
      const daysLeftInWeek = computeDaysLeftInWeek(currentWeekStartISO, now);

      // Count the current streak: start from this week if it's
      // already active, otherwise from last week (an in-progress,
      // not-yet-logged current week doesn't break the streak, it just
      // doesn't count toward it yet).
      const startIdx = isActiveThisWeek ? 0 : 1;
      let count = 0;
      for (let i = startIdx; i < weeks.length; i += 1) {
        if (weeks[i].active) count += 1;
        else break;
      }

      // Longest run anywhere in the window (may include the still-
      // open current streak).
      let longestStreak = 0;
      let run = 0;
      for (const w of weeks) {
        if (w.active) {
          run += 1;
          longestStreak = Math.max(longestStreak, run);
        } else {
          run = 0;
        }
      }

      // Recovery candidate: the week that actually broke the current
      // streak, if it's recent enough and there's real streak history
      // (not just nothing) before it — otherwise this is just "never
      // started a streak," not a recoverable break.
      let recoverable: WeekSummary | null = null;
      const breakIdx = startIdx + count;
      if (breakIdx < weeks.length && breakIdx <= RECOVERY_WINDOW_WEEKS) {
        const hasOlderActivity = weeks.slice(breakIdx + 1).some((w) => w.active);
        if (hasOlderActivity) {
          recoverable = weeks[breakIdx];
        }
      }

      // count === 0 implies !isActiveThisWeek (an active current week
      // always contributes at least 1 to count) — checked first so
      // the two branches below don't need to re-guard against it.
      const riskLevel: RiskLevel =
        count === 0
          ? 'none'
          : isActiveThisWeek
            ? 'safe'
            : daysLeftInWeek <= 1
              ? 'urgent'
              : 'pending';

      const recentWeeks = [...weeks].reverse().slice(-RECENT_WEEKS_FOR_DISPLAY);
      const { recoveryUsesRemaining, nextRecoveryAvailableAt } = computeRecoveryAvailability(
        settings?.streakRecoveryDates,
        now,
      );

      if (!cancelled) {
        setResult({
          status: 'ready',
          count,
          isActiveThisWeek,
          daysLeftInWeek,
          riskLevel,
          longestStreak,
          recentWeeks,
          recoverable,
          recoveryUsesRemaining,
          nextRecoveryAvailableAt,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [weekPlanRepo, weekLogRepo, settings, refreshKey]);

  return result;
}
