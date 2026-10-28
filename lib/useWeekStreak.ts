'use client';

// Duolingo-style weekly streak — consecutive weeks with ANY logged
// activity, not full plan completion. A low bar on purpose: this app's
// established voice is autonomy-supportive, never guilt-driven (same
// principle already encoded in Kenji's copy rules in
// packages/insights/src/prompt.ts) — a streak that demands a fully
// completed week would punish an honest, partial week instead of
// recognizing that the person still showed up.
//
// Mostly derived from existing WeekPlan/WeekLogEntry data, plus one
// small persisted field (Settings.streakRecoveries) for recovery usage
// history — see computeRecoveryAvailability below for why that can't
// be derived. Runs in TopNav (every page), so reads for the lookback
// window are fetched in parallel, not one week at a time.

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
// Recovery uses are earned from recent logging, not a flat allowance —
// assumption from the product ask: every LOGS_PER_RECOVERY log entries
// saved within the trailing LOG_WINDOW_DAYS earns one recovery use,
// rounded up (so any logging at all earns something, not just
// multiples of 4 — logging twice still earns 1). Both earning AND
// spending are evaluated over the same rolling window, so a used
// recovery and the logging that earned it age out together rather
// than needing separate "period reset" bookkeeping.
const LOG_WINDOW_DAYS = 14;
const LOGS_PER_RECOVERY = 4;
// Ceiling on earned recoveries per window — logging very frequently
// (e.g. several times a day) shouldn't translate into an effectively
// unlimited recovery allowance. Doesn't bind on the examples that
// motivated this formula (2 logs -> 1, 7 logs -> 2); only kicks in for
// much heavier logging than that.
const MAX_EARNED_RECOVERIES = 3;

export type RiskLevel =
  | 'none' // no streak yet
  | 'safe' // this week already has logged activity
  | 'pending' // no activity yet this week, but there's still time
  | 'urgent'; // no activity yet, and the week is about to end

export type WeekSummary = {
  weekStartISO: string;
  // True if either genuinely logged OR healed via a streak recovery
  // (see recovered below) — this is the "counts toward the streak"
  // flag used by all the counting logic in this file.
  active: boolean;
  // True only for a week healed via recovery rather than real logged
  // hours — lets the UI (history strip, overview trend chart) show a
  // recovered week differently from a genuinely logged one instead of
  // claiming hours that were never actually logged.
  recovered: boolean;
};

export type WeekStreakResult = {
  status: 'loading' | 'ready';
  // Consecutive weeks of logged (or recovered) activity, most recent
  // first. Includes the current week only once it has its own logged
  // activity — an in-progress week doesn't retroactively break the
  // streak just because today hasn't been logged yet, but it also
  // doesn't get counted until it actually has something in it.
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
  // history before it (not just "never started"). Recovering it heals
  // the streak immediately — no logging required (see
  // recordStreakRecoveryUse).
  recoverable: WeekSummary | null;
  // How many recoveries are still available within the rolling
  // window — 0 means recoverable (if set) can be shown but not acted
  // on until nextRecoveryAvailableAt (or until more logging earns a
  // fresh one — see earnedRecoveries).
  recoveryUsesRemaining: number;
  // How many recoveries the person's recent logging has earned this
  // window, before subtracting uses already spent. 0 means the
  // exhausted state is "log something to earn a recovery," not "wait
  // out a timer" — the UI should phrase those two differently.
  earnedRecoveries: number;
  // ISO date the next recovery use becomes available again, once the
  // oldest use blocking the current window ages out. Null when a use
  // is available right now, or when nothing's blocking (earned 0,
  // used 0) — in that case logging is what unlocks it, not time.
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
  recoveryUsesRemaining: 0,
  earnedRecoveries: 0,
  nextRecoveryAvailableAt: null,
};

export type StreakRecoveryUse = { usedAt: string; weekStartISO: string };

export function computeEarnedRecoveries(recentLogActionCount: number): number {
  return Math.min(MAX_EARNED_RECOVERIES, Math.ceil(recentLogActionCount / LOGS_PER_RECOVERY));
}

export function computeRecoveryAvailability(
  recentLogActionCount: number,
  recoveries: StreakRecoveryUse[] | undefined,
  now: Date,
): { recoveryUsesRemaining: number; earnedRecoveries: number; nextRecoveryAvailableAt: string | null } {
  const windowMs = LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  const earnedRecoveries = computeEarnedRecoveries(recentLogActionCount);
  const usesWithinWindow = (recoveries ?? [])
    .map((r) => new Date(r.usedAt).getTime())
    .filter((t) => Number.isFinite(t) && t > cutoff)
    .sort((a, b) => a - b);

  const remaining = Math.max(0, earnedRecoveries - usesWithinWindow.length);
  if (remaining > 0) {
    return { recoveryUsesRemaining: remaining, earnedRecoveries, nextRecoveryAvailableAt: null };
  }
  if (usesWithinWindow.length === 0) {
    // Nothing earned, nothing spent — there's no outstanding use to
    // age out and open a slot. Only fresh logging unlocks one.
    return { recoveryUsesRemaining: 0, earnedRecoveries, nextRecoveryAvailableAt: null };
  }
  // At the earned limit — the next slot opens when the OLDEST use
  // inside the window ages past it (assuming no additional logging
  // earns one sooner — this date is a worst case, not a promise).
  const oldestBlocking = usesWithinWindow[0];
  const nextAvailable = new Date(oldestBlocking + windowMs).toISOString();
  return { recoveryUsesRemaining: 0, earnedRecoveries, nextRecoveryAvailableAt: nextAvailable };
}

/**
 * Records a streak-recovery use and returns the updated Settings —
 * call right when the person commits to recovering (clicking the
 * "Recover streak" button). Recovery no longer requires logging real
 * hours for the healed week (a big ask for a week someone may not
 * remember anything about) — this is the entire act of recovering, a
 * standalone function rather than something the hook itself does,
 * since it's a write (needs settingsRepo), while the hook is
 * otherwise read-only derived state. Caller is responsible for
 * persisting via settingsRepo.saveSettings and triggering a recompute
 * (e.g. via useBumpSync()).
 */
export function recordStreakRecoveryUse(
  settings: Settings,
  weekStartISO: string,
  now: Date = new Date(),
): Settings {
  const recoveries = [...(settings.streakRecoveries ?? []), { usedAt: now.toISOString(), weekStartISO }];
  // Defensive cap matching the schema's own — shouldn't realistically
  // be reached (earned recoveries are capped per window too), but
  // trims the oldest first rather than relying on that holding forever.
  const trimmed = recoveries.length > 200 ? recoveries.slice(recoveries.length - 200) : recoveries;
  return { ...settings, streakRecoveries: trimmed };
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

      // Earliest week with any real plan, across ALL plans (not just
      // the lookback window) — weeks before this aren't "missed," the
      // account/habit just didn't exist yet. Used below so the
      // history strip doesn't fabricate false misses for a new user.
      const earliestPlanWeekISO = allPlans.reduce<string | null>(
        (earliest, plan) =>
          earliest === null || plan.weekStartISO < earliest ? plan.weekStartISO : earliest,
        null,
      );

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

      const recoveredWeekISOs = new Set((settings?.streakRecoveries ?? []).map((r) => r.weekStartISO));

      const weeks: WeekSummary[] = weekStartISOs.map((iso) => {
        const hasLogs = logsByWeek.has(iso) ? weekHasLoggedActivity(logsByWeek.get(iso)!) : false;
        const recovered = recoveredWeekISOs.has(iso);
        return { weekStartISO: iso, active: hasLogs || recovered, recovered };
      });

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

      // Oldest-first for the calendar-strip. Weeks before the account's
      // first-ever plan are dropped rather than shown as "missed" —
      // without this, a brand-new account would show several fake
      // missed weeks padding the left edge before it ever had a
      // chance to log anything. Short real history naturally renders
      // as fewer cells, left-anchored, growing rightward with the
      // account rather than always forcing exactly 8.
      const recentWeeks = [...weeks]
        .reverse()
        .filter((w) => !earliestPlanWeekISO || w.weekStartISO >= earliestPlanWeekISO)
        .slice(-RECENT_WEEKS_FOR_DISPLAY);

      // How many times hours were actually saved in the trailing
      // LOG_WINDOW_DAYS — the basis for how many recoveries have been
      // earned (see computeRecoveryAvailability). Counts save actions
      // (updatedAt), not which date the hours were logged against, so
      // backfilling an old date in one sitting counts once, not once
      // per date covered.
      const logWindowCutoff = now.getTime() - LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const recentLogActionCount = Array.from(logsByWeek.values())
        .flat()
        .filter((entry) => new Date(entry.updatedAt).getTime() > logWindowCutoff).length;

      const { recoveryUsesRemaining, earnedRecoveries, nextRecoveryAvailableAt } = computeRecoveryAvailability(
        recentLogActionCount,
        settings?.streakRecoveries,
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
          earnedRecoveries,
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
