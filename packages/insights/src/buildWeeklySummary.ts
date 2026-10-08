import type { WeekLogEntry, WeekPlan } from '@ikigai/core';
import type { PersonalityRead } from './traits';
import type {
  PriorInsight,
  WeeklyDomainSummary,
  WeeklyMetricsSummary,
  WeeklyPeriodTotals,
  WeeklyTaskSummary,
} from './summary';
import { computeWeeklySignals } from './signals';

// Sums a set of WeekLogEntry rows into per-task hours, the same
// reduction LogPanel's `weekTotals` and the Overview page's history
// summaries already use — additive across entries by construction.
const sumTaskHours = (logs: WeekLogEntry[]): Record<string, number> => {
  const totals: Record<string, number> = {};
  logs.forEach((log) => {
    Object.entries(log.taskHours).forEach(([taskId, hours]) => {
      totals[taskId] = (totals[taskId] || 0) + hours;
    });
  });
  return totals;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

const summarizePeriod = (
  plan: WeekPlan,
  logs: WeekLogEntry[],
): WeeklyPeriodTotals => {
  const taskTotals = sumTaskHours(logs);
  let plannedHours = 0;
  let loggedHours = 0;
  plan.domains.forEach((domain) => {
    domain.tasks.forEach((task) => {
      plannedHours += task.plannedHours || 0;
      loggedHours += taskTotals[task.id] || 0;
    });
  });
  return {
    plannedHours: round1(plannedHours),
    loggedHours: round1(loggedHours),
    completionRatio: plannedHours > 0 ? round1(loggedHours / plannedHours) : 0,
  };
};

// Per-domain breakdown, keyed by domain NAME rather than id — domain
// ids can differ week to week if a plan was recreated rather than
// carried forward, but the name is the stable, human-meaningful join
// key a person would recognize ("Health" is still "Health").
const summarizeDomainsByName = (
  plan: WeekPlan,
  logs: WeekLogEntry[],
): Map<string, { plannedHours: number; loggedHours: number; completionRatio: number }> => {
  const taskTotals = sumTaskHours(logs);
  const byName = new Map<string, { plannedHours: number; loggedHours: number; completionRatio: number }>();
  plan.domains.forEach((domain) => {
    const plannedHours = round1(domain.plannedHours || 0);
    const loggedHours = round1(
      domain.tasks.reduce((sum, task) => sum + (taskTotals[task.id] || 0), 0),
    );
    byName.set(domain.name, {
      plannedHours,
      loggedHours,
      completionRatio: plannedHours > 0 ? round1(loggedHours / plannedHours) : 0,
    });
  });
  return byName;
};

// Per-domain, per-task-NAME hours (same name-not-id join-key reasoning
// as summarizeDomainsByName — a task can be recreated week to week and
// the title is what a person actually recognizes). Tasks sharing a
// title within one domain are summed together, same as domains sharing
// a name would be.
const summarizeTasksByName = (
  plan: WeekPlan,
  logs: WeekLogEntry[],
): Map<string, Map<string, number>> => {
  const taskTotals = sumTaskHours(logs);
  const byDomain = new Map<string, Map<string, number>>();
  plan.domains.forEach((domain) => {
    const byTaskName = new Map<string, number>();
    domain.tasks.forEach((task) => {
      const hours = taskTotals[task.id] || 0;
      byTaskName.set(task.title, round1((byTaskName.get(task.title) ?? 0) + hours));
    });
    byDomain.set(domain.name, byTaskName);
  });
  return byDomain;
};

// The single task whose OWN hours moved enough to be most of the
// reason the domain's total moved — see WeeklyTaskSummary in summary.ts
// for why this is deterministic rather than left to the model to guess
// from raw numbers (same reasoning as every other "should this fire"
// decision in this package). Requires: (1) the domain has 2+ tasks —
// with only one task, naming it separately is redundant with naming the
// domain; (2) prior week data exists for this domain — without a
// baseline there's no "moved" to explain, only "existed"; (3) the
// biggest single-task delta accounts for at least half of the domain's
// own total delta — otherwise the change is genuinely spread across
// several tasks and singling one out would misrepresent it; (4) that
// delta is at least 1 hour — below that it's noise, not a standout.
const MIN_STANDOUT_SHARE = 0.5;
const MIN_STANDOUT_HOURS = 1;

function computeTopTask(
  domainTaskCount: number,
  domainDelta: number,
  thisWeekTasks: Map<string, number> | undefined,
  priorWeekTasks: Map<string, number> | undefined,
): WeeklyTaskSummary | null {
  if (domainTaskCount < 2 || !thisWeekTasks || !priorWeekTasks) return null;

  let best: { name: string; loggedHours: number; priorLoggedHours: number; delta: number } | null = null;
  const taskNames = new Set([...thisWeekTasks.keys(), ...priorWeekTasks.keys()]);
  taskNames.forEach((name) => {
    const loggedHours = thisWeekTasks.get(name) ?? 0;
    const priorLoggedHours = priorWeekTasks.get(name) ?? 0;
    const delta = loggedHours - priorLoggedHours;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { name, loggedHours, priorLoggedHours, delta };
    }
  });
  if (!best) return null;

  const resolved = best as { name: string; loggedHours: number; priorLoggedHours: number; delta: number };
  const domainDeltaMagnitude = Math.abs(domainDelta);
  if (Math.abs(resolved.delta) < MIN_STANDOUT_HOURS) return null;
  if (domainDeltaMagnitude > 0 && Math.abs(resolved.delta) / domainDeltaMagnitude < MIN_STANDOUT_SHARE) {
    return null;
  }

  return {
    name: resolved.name,
    loggedHours: resolved.loggedHours,
    priorLoggedHours: resolved.priorLoggedHours,
  };
}

const daysElapsed = (weekStartISO: string, now: Date): number => {
  const start = new Date(weekStartISO);
  const msPerDay = 24 * 60 * 60 * 1000;
  const elapsed = Math.floor((now.getTime() - start.getTime()) / msPerDay) + 1;
  return Math.min(7, Math.max(0, elapsed));
};

export function buildWeeklyMetricsSummary(input: {
  weekPlan: WeekPlan;
  weekLogs: WeekLogEntry[];
  priorWeekPlan: WeekPlan | null;
  priorWeekLogs: WeekLogEntry[];
  // Weeks before priorWeekPlan, most-recent-first — only used to detect
  // a chronic (multi-week) pattern via computeWeeklySignals'
  // sustained_underdelivery check. Never crosses the network itself;
  // only the resulting already-phrased signal detail does.
  olderWeeks?: { weekPlan: WeekPlan; weekLogs: WeekLogEntry[] }[];
  reflectionNoteCount: number;
  contextNote?: string | null;
  // Best-effort, from the companion feature's own persona_summary (a
  // signed-in-only Supabase read — see app/insights/page.tsx). Purely
  // passed through; never derived or fetched here.
  personaNote?: string | null;
  personalityRead: PersonalityRead;
  now: Date;
  // Best-effort, from the caller's own local cache of the prior week's
  // insight — see useWeeklyInsight.ts. Purely passed through into the
  // summary for the prompt to use; never derived or fetched here.
  priorInsight?: PriorInsight | null;
}): WeeklyMetricsSummary {
  const {
    weekPlan,
    weekLogs,
    priorWeekPlan,
    priorWeekLogs,
    olderWeeks = [],
    reflectionNoteCount,
    contextNote,
    personaNote = null,
    personalityRead,
    now,
    priorInsight = null,
  } = input;

  const taskTotals = sumTaskHours(weekLogs);
  const priorByName = priorWeekPlan
    ? summarizeDomainsByName(priorWeekPlan, priorWeekLogs)
    : null;
  const thisWeekTasksByDomain = summarizeTasksByName(weekPlan, weekLogs);
  const priorWeekTasksByDomain = priorWeekPlan
    ? summarizeTasksByName(priorWeekPlan, priorWeekLogs)
    : null;

  const domains: WeeklyDomainSummary[] = weekPlan.domains.map((domain) => {
    const plannedHours = round1(domain.plannedHours || 0);
    const loggedHours = round1(
      domain.tasks.reduce((sum, task) => sum + (taskTotals[task.id] || 0), 0),
    );
    const prior = priorByName?.get(domain.name) ?? null;
    const domainDelta = prior ? loggedHours - prior.loggedHours : 0;
    return {
      name: domain.name,
      principleId: domain.principleId,
      plannedHours,
      loggedHours,
      completionRatio: plannedHours > 0 ? round1(loggedHours / plannedHours) : 0,
      taskCount: domain.tasks.length,
      completedTaskCount: domain.tasks.filter((t) => Boolean(t.completedAt))
        .length,
      priorPlannedHours: prior ? prior.plannedHours : null,
      priorCompletionRatio: prior ? prior.completionRatio : null,
      topTask: computeTopTask(
        domain.tasks.length,
        domainDelta,
        thisWeekTasksByDomain.get(domain.name),
        priorWeekTasksByDomain?.get(domain.name),
      ),
    };
  });

  // Truncated defensively — the schema caps goal text at 120 chars, but
  // nothing upstream enforces that on write, so a longer goal shouldn't
  // fail the whole insight request over it.
  const goals = (weekPlan.goals ?? []).map((goal) => ({
    text: goal.text.slice(0, 120),
    completed: Boolean(goal.completedAt),
  }));

  const base = {
    weekId: weekPlan.id,
    daysElapsedInWeek: daysElapsed(weekPlan.weekStartISO, now),
    totals: summarizePeriod(weekPlan, weekLogs),
    domains,
    priorWeek: priorWeekPlan
      ? summarizePeriod(priorWeekPlan, priorWeekLogs)
      : null,
    goals,
    reflectionNoteCount,
    contextNote: contextNote?.slice(0, 200) || null,
    personaNote,
    personalityRead,
    priorInsight,
  };

  // Older weeks' completion ratios, by domain name, most-recent-first —
  // feeds the chronic-pattern check only. Per domain, stop at the
  // first older week that doesn't have it — a gap means there's no
  // CONTINUOUS history past that point, so later (older-still) weeks
  // that happen to have the domain again shouldn't silently splice
  // onto a broken streak.
  const olderByName = olderWeeks.map(({ weekPlan: olderPlan, weekLogs: olderLogs }) =>
    summarizeDomainsByName(olderPlan, olderLogs),
  );
  const priorRatiosByDomain: Record<string, number[]> = {};
  domains.forEach((domain) => {
    const ratios: number[] = [];
    for (const byName of olderByName) {
      const entry = byName.get(domain.name);
      if (!entry) break;
      ratios.push(entry.completionRatio);
    }
    priorRatiosByDomain[domain.name] = ratios;
  });

  return { ...base, signals: computeWeeklySignals(base, priorRatiosByDomain) };
}

// Same lightweight djb2-style hash already used inline in the Overview
// page (app/history/page.tsx `hashString`) for domain-color assignment —
// reused here as a cheap cache-invalidation key, not a security primitive.
export function hashWeeklySummary(summary: WeeklyMetricsSummary): string {
  const value = JSON.stringify(summary);
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
