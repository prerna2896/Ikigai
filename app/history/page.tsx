'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../lib/errors';
import Link from 'next/link';
import type {
  Settings,
  WeekLogEntry,
  WeekNote,
  WeekPlan,
} from '@ikigai/core';
import { suggestPrincipleForName, type IkigaiPrincipleId } from '@ikigai/core';
import { getWeekEndISO, withDerivedPlannedHours } from '../week/plan/planUtils';
import { useRepository } from '../../components/RepositoryProvider';
import { useCloudSyncVersion } from '../../components/CloudSyncProvider';
import {
  decodeReflectionNote,
  type ParsedReflectionNote,
} from '../../lib/reflectionNotes';

const toLocalDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
};

const addDaysISO = (isoDate: string, days: number) => {
  const date = toLocalDate(isoDate);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekStartISOForDate = (
  date: Date,
  weekStartDay: Settings['weekStartDay'],
) => {
  const target = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }[weekStartDay];
  const day = date.getDay();
  const diff = (day - target + 7) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - diff);
  const year = start.getFullYear();
  const month = `${start.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${start.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
};

const toDateInputValue = (isoDate: string | null) => isoDate ?? '';

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const domainPalette = [
  { r: 140, g: 182, b: 170 },
  { r: 176, g: 196, b: 138 },
  { r: 183, g: 157, b: 205 },
  { r: 209, g: 165, b: 149 },
  { r: 156, g: 178, b: 214 },
  { r: 214, g: 196, b: 140 },
  { r: 150, g: 166, b: 188 },
];

const IKIGAI_COLORS: Record<
  'energy' | 'growth' | 'contribution' | 'alignment',
  { r: number; g: number; b: number }
> = {
  energy: { r: 127, g: 183, b: 173 },
  growth: { r: 166, g: 190, b: 132 },
  contribution: { r: 208, g: 161, b: 93 },
  alignment: { r: 179, g: 140, b: 182 },
};

const getDomainColor = (name: string) => {
  const color = domainPalette[hashString(name) % domainPalette.length];
  return color ?? domainPalette[0];
};

const formatRange = (weekPlan: WeekPlan, timeZone: string) => {
  const start = new Date(`${weekPlan.weekStartISO}T00:00:00`);
  const end = new Date(`${weekPlan.weekEndISO}T00:00:00`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

export default function HistoryPage() {
  const { settingsRepo, weekPlanRepo, weekLogRepo, weekNoteRepo } =
    useRepository();
  const cloudVersion = useCloudSyncVersion();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weekPlans, setWeekPlans] = useState<WeekPlan[]>([]);
  const [weekLogsByWeek, setWeekLogsByWeek] = useState<
    Record<string, WeekLogEntry[]>
  >({});
  const [notesByWeek, setNotesByWeek] = useState<Record<string, WeekNote[]>>(
    {},
  );
  const [status, setStatus] = useState<string | null>(null);
  const [selectedHistoryWeekId, setSelectedHistoryWeekId] = useState<string | null>(
    null,
  );
  const [rangeStartISO, setRangeStartISO] = useState<string | null>(null);
  const [rangeEndISO, setRangeEndISO] = useState<string | null>(null);
  const [hoveredSeries, setHoveredSeries] = useState<{
    x: number;
    y: number;
    type: string;
    value: number;
  } | null>(null);

  useEffect(() => {
    if (!settingsRepo || !weekPlanRepo || !weekLogRepo || !weekNoteRepo) {
      return;
    }
    Promise.all([settingsRepo.getSettings(), weekPlanRepo.listWeekPlans()])
      .then(async ([settingsRecord, plans]) => {
        setSettings(settingsRecord);
        if (plans.length === 0) {
          setWeekPlans([]);
          setWeekLogsByWeek({});
          return;
        }

        // Remove seeded plans: the seed function spread task objects verbatim
        // (including their `id` field), so seeded plans share task IDs with
        // the real current plan. Genuine past plans always use fresh UUIDs.
        const newest = [...plans].sort((a, b) =>
          a.weekStartISO < b.weekStartISO ? 1 : -1,
        )[0];
        if (newest) {
          const realTaskIds = new Set(
            newest.domains.flatMap((d) => d.tasks.map((t) => t.id)),
          );
          const seeded = plans.filter(
            (p) =>
              p.id !== newest.id &&
              p.domains.some((d) =>
                d.tasks.some((t) => realTaskIds.has(t.id)),
              ),
          );
          if (seeded.length > 0) {
            await Promise.all(
              seeded.map((p) => weekPlanRepo.deleteWeekPlan(p.id)),
            );
            plans = plans.filter((p) => !seeded.some((s) => s.id === p.id));
          }
        }

        const sorted = [...plans].sort((a, b) =>
          a.weekStartISO < b.weekStartISO ? 1 : -1,
        );
        setWeekPlans(sorted);
        const logsByWeek: Record<string, WeekLogEntry[]> = {};
        await Promise.all(
          sorted.map(async (plan) => {
            const logs = await weekLogRepo.getWeekLogs(plan.id);
            logsByWeek[plan.id] = [...logs].sort((a, b) =>
              a.dateISO < b.dateISO ? 1 : -1,
            );
          }),
        );
        setWeekLogsByWeek(logsByWeek);
        const notesMap: Record<string, WeekNote[]> = {};
        await Promise.all(
          sorted.map(async (plan) => {
            const notes = await weekNoteRepo.listWeekNotes(plan.id);
            notesMap[plan.id] = [...notes].sort((a, b) =>
              a.createdAt < b.createdAt
                ? 1
                : a.createdAt > b.createdAt
                  ? -1
                  : 0,
            );
          }),
        );
        setNotesByWeek(notesMap);
        const currentId = sorted[0].id;
        setSelectedHistoryWeekId((prev) => prev ?? currentId);
      })
      .catch((error) => setStatus(errorMessage(error)));
  }, [settingsRepo, weekPlanRepo, weekLogRepo, weekNoteRepo, cloudVersion]);


  const timeZone =
    settings?.weekTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const historySummaries = useMemo(() => {
    if (!weekPlans.length) {
      return [];
    }
    return weekPlans
      .slice()
      .sort((a, b) => (a.weekStartISO < b.weekStartISO ? 1 : -1))
      .map((plan) => {
        const tasks = plan.domains.flatMap((domain) =>
          domain.tasks.map((task) => ({
            id: task.id,
            plannedHours: task.plannedHours,
            domainName: domain.name,
          })),
        );
        const plannedTotal = tasks.reduce(
          (sum, task) => sum + task.plannedHours,
          0,
        );
        const logs = weekLogsByWeek[plan.id] ?? [];
        const completedByTask: Record<string, number> = {};
        logs.forEach((log) => {
          Object.entries(log.taskHours).forEach(([taskId, hours]) => {
            completedByTask[taskId] = (completedByTask[taskId] || 0) + hours;
          });
        });
        const completedTotal = tasks.reduce(
          (sum, task) => sum + (completedByTask[task.id] || 0),
          0,
        );
        const cappedCompletedTotal = Math.min(168, completedTotal);
        const domainTotals: Record<
          string,
          { planned: number; completed: number }
        > = {};
        tasks.forEach((task) => {
          if (!domainTotals[task.domainName]) {
            domainTotals[task.domainName] = { planned: 0, completed: 0 };
          }
          domainTotals[task.domainName].planned += task.plannedHours;
          domainTotals[task.domainName].completed += completedByTask[task.id] || 0;
        });
        return {
          weekId: plan.id,
          rangeLabel: formatRange(plan, timeZone),
          plannedTotal,
          completedTotal: cappedCompletedTotal,
          adherence:
            plannedTotal > 0 ? cappedCompletedTotal / plannedTotal : 0,
          domainTotals,
        };
      });
  }, [weekPlans, weekLogsByWeek, timeZone]);

  useEffect(() => {
    if (!historySummaries.length) {
      setRangeStartISO(null);
      setRangeEndISO(null);
      return;
    }
    setRangeEndISO((prev) => prev ?? historySummaries[0].weekId);
    setRangeStartISO((prev) => {
      if (prev) return prev;
      // default: 4 weeks back from the most recent week
      const newest = historySummaries[0].weekId;
      return addDaysISO(newest, -21);
    });
  }, [historySummaries]);

  const orderedSummariesAsc = useMemo(
    () => historySummaries.slice().reverse(),
    [historySummaries],
  );

  const selectedSummary = useMemo(() => {
    if (!selectedHistoryWeekId) {
      return historySummaries[0] ?? null;
    }
    return (
      historySummaries.find((summary) => summary.weekId === selectedHistoryWeekId) ??
      historySummaries[0] ??
      null
    );
  }, [historySummaries, selectedHistoryWeekId]);

  const domainAlignment = useMemo(() => {
    if (!selectedSummary) {
      return [];
    }
    return Object.entries(selectedSummary.domainTotals)
      .map(([domainName, totals]) => {
        const completion =
          totals.planned > 0 ? Math.min(1, totals.completed / totals.planned) : 0;
        return {
          name: domainName,
          planned: totals.planned,
          completed: totals.completed,
          completion,
        };
      })
      .sort((a, b) => b.planned - a.planned);
  }, [selectedSummary]);

  const ikigaiAlignment = useMemo(() => {
    if (!selectedSummary) {
      return [];
    }
    const totals: Record<IkigaiPrincipleId, { planned: number; completed: number }> =
      {
        energy: { planned: 0, completed: 0 },
        growth: { planned: 0, completed: 0 },
        contribution: { planned: 0, completed: 0 },
        alignment: { planned: 0, completed: 0 },
      };
    Object.entries(selectedSummary.domainTotals).forEach(([domainName, values]) => {
      // History rolls up by domain *name*, so we don't have the
      // domain object's explicit principleId here — fall back to the
      // same keyword inference the editor uses as a default.
      const key = suggestPrincipleForName(domainName);
      totals[key].planned += values.planned;
      totals[key].completed += values.completed;
    });
    const labels: Record<IkigaiPrincipleId, string> = {
      energy: 'Energy',
      growth: 'Growth',
      contribution: 'Contribution',
      alignment: 'Alignment',
    };
    return (Object.keys(totals) as IkigaiPrincipleId[]).map((key) => {
      const entry = totals[key];
      const completion =
        entry.planned > 0 ? Math.min(1, entry.completed / entry.planned) : 0;
      return {
        id: key,
        label: labels[key],
        planned: entry.planned,
        completed: entry.completed,
        completion,
      };
    });
  }, [selectedSummary]);

  const currentWeekId = useMemo(() => weekPlans[0]?.id ?? null, [weekPlans]);
  const isCurrentWeek = selectedSummary?.weekId === currentWeekId;

  const domainInsights = useMemo(() => {
    if (!historySummaries.length) {
      return [];
    }
    const domainBuckets: Record<string, number[]> = {};
    const domainPlanned: Record<string, number> = {};
    historySummaries.forEach((summary) => {
      Object.entries(summary.domainTotals).forEach(([domainName, totals]) => {
        if (!domainBuckets[domainName]) {
          domainBuckets[domainName] = [];
          domainPlanned[domainName] = 0;
        }
        const ratio =
          totals.planned > 0 ? totals.completed / totals.planned : 0;
        domainBuckets[domainName].push(ratio);
        domainPlanned[domainName] += totals.planned;
      });
    });
    return Object.entries(domainBuckets)
      .map(([domainName, ratios]) => {
        const avg = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
        const variance =
          ratios.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
          ratios.length;
        const stdDev = Math.sqrt(variance);
        const trend =
          avg > 1.1
            ? 'Undercommitted'
            : avg < 0.8
              ? 'Overcommitted'
              : 'Well matched';
        const consistency = stdDev < 0.2 ? 'Steady' : 'Variable';
        const consistencyScore = Math.max(0, 1 - Math.min(stdDev / 0.35, 1));
        return {
          domainName,
          avg,
          consistency,
          trend,
          stdDev,
          consistencyScore,
          plannedTotal: domainPlanned[domainName] || 0,
        };
      })
      .sort((a, b) => b.plannedTotal - a.plannedTotal);
  }, [historySummaries]);

  const lastWeekSummary = historySummaries[1] ?? historySummaries[0] ?? null;

  const lastWeekDomainStats = useMemo(() => {
    if (!lastWeekSummary) {
      return [];
    }
    return Object.entries(lastWeekSummary.domainTotals)
      .map(([name, totals]) => {
        const completion =
          totals.planned > 0 ? totals.completed / totals.planned : 0;
        return {
          name,
          planned: totals.planned,
          completed: totals.completed,
          completion,
        };
      })
      .sort((a, b) => b.planned - a.planned);
  }, [lastWeekSummary]);

  const lastWeekBestMatch = useMemo(() => {
    if (lastWeekDomainStats.length === 0) {
      return null;
    }
    return lastWeekDomainStats.reduce((best, current) =>
      current.completion > best.completion ? current : best,
    );
  }, [lastWeekDomainStats]);

  const lastWeekUnderMatch = useMemo(() => {
    if (lastWeekDomainStats.length === 0) {
      return null;
    }
    return lastWeekDomainStats.reduce((worst, current) =>
      current.completion < worst.completion ? current : worst,
    );
  }, [lastWeekDomainStats]);

  const bestWeek = useMemo(() => {
    if (!historySummaries.length) {
      return null;
    }
    return historySummaries.reduce((best, current) =>
      current.adherence > best.adherence ? current : best,
    );
  }, [historySummaries]);

  const weakestWeek = useMemo(() => {
    if (!historySummaries.length) {
      return null;
    }
    return historySummaries.reduce((worst, current) =>
      current.adherence < worst.adherence ? current : worst,
    );
  }, [historySummaries]);

  const mostSteadyDomain = useMemo(() => {
    if (!domainInsights.length) {
      return null;
    }
    const steady = domainInsights.filter((domain) => domain.consistency === 'Steady');
    return (steady[0] ?? domainInsights[0]) ?? null;
  }, [domainInsights]);

  const snapshotSegments = useMemo(() => {
    if (!selectedSummary) {
      return [];
    }
    return Object.entries(selectedSummary.domainTotals)
      .map(([domainName, totals]) => {
        const plannedShare =
          selectedSummary.plannedTotal > 0
            ? Math.min(1, totals.planned / selectedSummary.plannedTotal)
            : 0;
        const completion =
          totals.planned > 0
            ? Math.min(1, totals.completed / totals.planned)
            : 0;
        return {
          domainName,
          plannedShare,
          completion,
        };
      })
      .sort((a, b) => b.plannedShare - a.plannedShare);
  }, [selectedSummary]);

  const weeklySeries = useMemo(() => {
    const ordered = historySummaries.slice().reverse(); // oldest first
    const filtered = ordered.filter((s) => {
      if (rangeStartISO && s.weekId < rangeStartISO) return false;
      if (rangeEndISO && s.weekId > rangeEndISO) return false;
      return true;
    });
    const points = filtered.map((summary, index) => ({
      index,
      label: summary.rangeLabel,
      weekId: summary.weekId,
      planned: summary.plannedTotal,
      completed: summary.completedTotal,
      hasLogs: (weekLogsByWeek[summary.weekId]?.length ?? 0) > 0,
    }));
    const totalWeekHours = 168;
    const baselineAvailable = settings
      ? Math.max(
          0,
          totalWeekHours -
            settings.sleepHoursPerDay * 7 -
            settings.maintenanceHoursPerDay * 7,
        )
      : null;
    const maxHours = points.reduce(
      (max, point) => Math.max(max, point.planned, point.completed),
      totalWeekHours,
    );
    return { points, maxHours, totalWeekHours, baselineAvailable };
  }, [historySummaries, weekLogsByWeek, settings, rangeStartISO, rangeEndISO]);

  const mostOvercommitted = useMemo(() => {
    return domainInsights
      .filter((domain) => domain.trend === 'Overcommitted')
      .sort((a, b) => a.avg - b.avg)[0];
  }, [domainInsights]);

  const mostUndercommitted = useMemo(() => {
    return domainInsights
      .filter((domain) => domain.trend === 'Undercommitted')
      .sort((a, b) => b.avg - a.avg)[0];
  }, [domainInsights]);

  const reflectionWeeks = useMemo(() => {
    return weekPlans
      .map((plan) => {
        const decoded: ParsedReflectionNote[] = (notesByWeek[plan.id] ?? [])
          .map(decodeReflectionNote)
          .filter((n) => n.text.trim().length > 0 || Boolean(n.emoji));
        return { plan, notes: decoded };
      })
      .filter((entry) => entry.notes.length > 0);
  }, [weekPlans, notesByWeek]);

  const selectedWeekNotes = useMemo(() => {
    if (!selectedSummary) return [];
    return (notesByWeek[selectedSummary.weekId] ?? [])
      .map(decodeReflectionNote)
      .filter((n) => n.text.trim().length > 0 || Boolean(n.emoji));
  }, [selectedSummary, notesByWeek]);

  return (
    <main
      className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12"
      data-testid="history-page"
    >
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Overview
        </p>
        <h1 className="text-3xl font-semibold text-text">
          Weekly follow-through and patterns
        </h1>
        <p className="text-sm text-mutedText">
          See how the plan and reality aligned over the past few weeks.
        </p>
        {status ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {status}
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-6 shadow-sm">
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Last week follow-through
            </p>
            <p className="mt-2 text-2xl font-semibold text-text">
              {Math.round((lastWeekSummary?.adherence ?? 0) * 100)}%
            </p>
            <p className="text-xs text-mutedText">
              {lastWeekSummary?.rangeLabel ?? 'Most recent week'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Most planned domain
            </p>
            <p className="mt-2 text-lg font-semibold text-text min-w-0 truncate">
              {lastWeekDomainStats[0]?.name ?? '—'}
            </p>
            <p className="text-xs text-mutedText">
              {lastWeekDomainStats[0]
                ? `${Math.round(lastWeekDomainStats[0].planned)}h planned`
                : 'No data yet.'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Best matched domain
            </p>
            <p className="mt-2 text-lg font-semibold text-text min-w-0 truncate">
              {lastWeekBestMatch?.name ?? '—'}
            </p>
            <p className="text-xs text-mutedText">
              {lastWeekBestMatch
                ? `${Math.round(lastWeekBestMatch.completion * 100)}% completed`
                : 'No data yet.'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Most under‑matched
            </p>
            <p className="mt-2 text-lg font-semibold text-text min-w-0 truncate">
              {lastWeekUnderMatch?.name ?? '—'}
            </p>
            <p className="text-xs text-mutedText">
              {lastWeekUnderMatch
                ? `${Math.round(lastWeekUnderMatch.completion * 100)}% completed`
                : 'No data yet.'}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-text">Key signals</h2>
        <p className="mt-1 text-xs text-mutedText">
          Quick takeaways based on recent weeks.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs text-mutedText">
          <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            {mostSteadyDomain
              ? `${mostSteadyDomain.domainName} stayed the most steady.`
              : 'No steady domain yet.'}
          </div>
          <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            {mostUndercommitted
              ? `${mostUndercommitted.domainName} often needed more time than planned.`
              : 'No consistent under-commitment yet.'}
          </div>
          <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            {mostOvercommitted
              ? `${mostOvercommitted.domainName} is often overestimated.`
              : 'No consistent over-commitment yet.'}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-6 shadow-sm">
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          {/* Weekly time series */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-text">
                Weekly time series
              </h2>
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-text">
                <input
                  type="date"
                  className="bg-transparent outline-none"
                  value={rangeStartISO ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    const weekStart = getWeekStartISOForDate(
                      new Date(`${value}T00:00:00`),
                      settings?.weekStartDay || 'sunday',
                    );
                    setRangeStartISO(weekStart);
                    if (rangeEndISO && weekStart > rangeEndISO) {
                      setRangeEndISO(addDaysISO(weekStart, 21));
                    }
                  }}
                />
                <span className="text-slate-400 select-none">–</span>
                <input
                  type="date"
                  className="bg-transparent outline-none"
                  value={rangeEndISO ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    const weekStart = getWeekStartISOForDate(
                      new Date(`${value}T00:00:00`),
                      settings?.weekStartDay || 'sunday',
                    );
                    setRangeEndISO(weekStart);
                    if (rangeStartISO && weekStart < rangeStartISO) {
                      setRangeStartISO(addDaysISO(weekStart, -21));
                    }
                  }}
                />
              </div>
            </div>
            <p className="mt-1 text-xs text-mutedText">
              Range boundaries snap to your week start day. Column height =
              168h week. Points show planned and completed. Hover for hours.
            </p>
            {weeklySeries.points.length ? (
              <>
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <svg
                    viewBox="0 0 520 210"
                    className="h-48 w-full overflow-visible"
                    role="img"
                    aria-label="Planned vs completed hours by week"
                    onMouseLeave={() => setHoveredSeries(null)}
                  >
                    {(() => {
                      const pL = 34;
                      const pR = 10;
                      const pT = 10;
                      const pB = 30;
                      const cW = 520 - pL - pR;
                      const cH = 210 - pT - pB;
                      const n = weeklySeries.points.length;
                      const totalH = 168;
                      const step = n > 1 ? cW / (n - 1) : 0;
                      const colW = n > 1 ? step : cW;
                      const baseline = pT + cH;

                      const toY = (v: number) => pT + cH - (v / totalH) * cH;
                      const ticks = [0, 50, 100, 150, 168];

                      return (
                        <>
                          {/* Y gridlines */}
                          {ticks.map((v) => (
                            <g key={v}>
                              <line
                                x1={pL} y1={toY(v)}
                                x2={pL + cW} y2={toY(v)}
                                stroke={v === 0 || v === 168 ? '#cbd5e1' : '#f1f5f9'}
                                strokeWidth="1"
                              />
                              <text x={pL - 4} y={toY(v) + 3.5} textAnchor="end" fontSize="9" fill="#94a3b8">
                                {v}h
                              </text>
                            </g>
                          ))}

                          {/* Week columns (total 168h background) + labels */}
                          {weeklySeries.points.map((point, i) => {
                            const cx = n > 1 ? pL + i * step : pL + cW / 2;
                            const colX = Math.max(pL, cx - colW / 2 + 2);
                            // Width must fit inside the plot area on
                            // BOTH sides — for a 2-point series,
                            // colW = cW, so a centered column on the
                            // right endpoint would extend past pL+cW
                            // without this clamp (the "green band
                            // spills off the right edge" bug).
                            const colActualW = Math.max(
                              0,
                              Math.min(colW - 4, pL + cW - colX),
                            );
                            const shortLabel = (() => {
                              const part = point.label.split('–')[0]?.trim() ?? point.label;
                              return part.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s*/, '');
                            })();
                            return (
                              <g key={`col-${point.weekId}`}>
                                <rect
                                  x={colX} y={pT}
                                  width={colActualW} height={cH}
                                  fill={point.hasLogs ? 'rgba(134,239,172,0.14)' : 'rgba(148,163,184,0.08)'}
                                  rx="3"
                                />
                                <text x={cx} y={baseline + 18} textAnchor="middle" fontSize="9" fill="#94a3b8">
                                  {shortLabel}
                                </text>
                              </g>
                            );
                          })}

                          {/* Connecting lines */}
                          {n > 1 && (
                            <>
                              <polyline
                                fill="none" stroke="#8cb4ae" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round"
                                points={weeklySeries.points.map((p, i) => `${pL + i * step},${toY(p.planned)}`).join(' ')}
                              />
                              <polyline
                                fill="none" stroke="#6b8fa8" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round"
                                points={weeklySeries.points.map((p, i) => `${pL + i * step},${toY(p.completed)}`).join(' ')}
                              />
                            </>
                          )}

                          {/* Interactive points */}
                          {weeklySeries.points.map((point, i) => {
                            const cx = n > 1 ? pL + i * step : pL + cW / 2;
                            const plannedY = toY(point.planned);
                            const completedY = toY(point.completed);
                            const overachieved = point.completed > point.planned;
                            return (
                              <g key={`pts-${point.weekId}`}>
                                <circle
                                  cx={cx} cy={plannedY} r="5"
                                  fill="#8cb4ae" stroke="white" strokeWidth="1.5"
                                  style={{ cursor: 'pointer' }}
                                  onMouseEnter={() => setHoveredSeries({ x: cx, y: plannedY, type: 'Planned', value: point.planned })}
                                />
                                <circle
                                  cx={cx} cy={completedY} r="5"
                                  fill={overachieved ? '#4d9e8e' : '#6b8fa8'} stroke="white" strokeWidth="1.5"
                                  style={{ cursor: 'pointer' }}
                                  onMouseEnter={() => setHoveredSeries({ x: cx, y: completedY, type: 'Completed', value: point.completed })}
                                />
                              </g>
                            );
                          })}

                          {/* Tooltip */}
                          {hoveredSeries && (() => {
                            const tw = 76;
                            const th = 34;
                            const tx = Math.min(Math.max(hoveredSeries.x - tw / 2, pL), pL + cW - tw);
                            const ty = hoveredSeries.y > pT + 40 ? hoveredSeries.y - th - 8 : hoveredSeries.y + 10;
                            return (
                              <g pointerEvents="none">
                                <rect x={tx} y={ty} width={tw} height={th} rx="5" fill="rgba(15,23,42,0.88)" />
                                <text x={tx + tw / 2} y={ty + 13} textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.65)">
                                  {hoveredSeries.type}
                                </text>
                                <text x={tx + tw / 2} y={ty + 27} textAnchor="middle" fontSize="12" fill="white" fontWeight="600">
                                  {Math.round(hoveredSeries.value)}h
                                </text>
                              </g>
                            );
                          })()}
                        </>
                      );
                    })()}
                  </svg>
                </div>
                <div className="mt-3 flex items-center gap-4 text-[11px] text-mutedText">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#8cb4ae]" />
                    Planned
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#6b8fa8]" />
                    Completed
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-3 rounded-sm" style={{ background: 'rgba(134,239,172,0.4)' }} />
                    Has logs
                  </span>
                </div>
              </>
            ) : (
              <p className="mt-4 text-xs text-mutedText">
                No plan data for the selected date range.
              </p>
            )}
          </div>

          {/* Weekly adherence */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">
                Weekly adherence
              </h2>
              <span className="text-xs text-mutedText">Planned vs. logged</span>
            </div>
            <div className="mt-4 space-y-3">
              {historySummaries.length === 0 ? (
                <p className="text-xs text-mutedText">No plan data yet.</p>
              ) : (
                historySummaries.map((summary) => {
                  const ratio = Math.min(
                    1,
                    summary.plannedTotal > 0
                      ? summary.completedTotal / summary.plannedTotal
                      : 0,
                  );
                  const isSelected = selectedSummary?.weekId === summary.weekId;
                  const hasLogs = (weekLogsByWeek[summary.weekId]?.length ?? 0) > 0;
                  return (
                    <button
                      key={summary.weekId}
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${
                        isSelected
                          ? 'border-accent bg-accentSoft text-text'
                          : 'border-slate-200 text-mutedText hover:bg-slate-50'
                      }`}
                      onClick={() => setSelectedHistoryWeekId(summary.weekId)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-text flex items-center gap-1.5">
                          {hasLogs && (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          )}
                          {summary.rangeLabel}
                        </span>
                        <span>
                          {Math.round(summary.completedTotal)}h /{' '}
                          {Math.round(summary.plannedTotal)}h
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-accent"
                          style={{ width: `${Math.round(ratio * 100)}%` }}
                        />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {bestWeek ? (
              <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-mutedText">
                Best alignment: {bestWeek.rangeLabel} · {Math.round(bestWeek.adherence * 100)}%
              </div>
            ) : null}
            {weakestWeek ? (
              <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-mutedText">
                Most drift: {weakestWeek.rangeLabel} · {Math.round(weakestWeek.adherence * 100)}%
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-6 shadow-sm">
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          {/* Domain + Ikigai alignment */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold text-text">
                  Domain + Ikigai alignment
                </h2>
                <p className="mt-1 text-xs text-mutedText">
                  Planned vs. completed for{' '}
                  {selectedSummary?.rangeLabel ?? 'this week'}.
                </p>
              </div>
              <div className="hidden items-center gap-3 text-[11px] text-mutedText sm:flex">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-accentSoft" />
                  Planned
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                  Completed
                </span>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
                  Domains
                </p>
                {domainAlignment.length === 0 ? (
                  <p className="text-xs text-mutedText">No data for this week.</p>
                ) : (
                  domainAlignment.map((domain) => (
                    <div
                      key={domain.name}
                      className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-2 text-xs text-mutedText sm:items-center">
                        <span className="font-medium text-text flex-shrink-0 min-w-0 truncate">{domain.name}</span>
                        <span className="flex-shrink-0 whitespace-nowrap">
                          {Math.round(domain.completed)}h · {Math.round(domain.planned)}h
                        </span>
                      </div>
                      <div className="mt-3 h-3 w-full rounded-full bg-slate-100">
                        <div className="h-3 rounded-full bg-accentSoft" style={{ width: '100%' }} />
                        <div
                          className="mt-[-12px] h-3 rounded-full"
                          style={{
                            width: `${Math.min(100, Math.round(domain.completion * 100))}%`,
                            backgroundColor: `rgba(${getDomainColor(domain.name).r}, ${getDomainColor(domain.name).g}, ${getDomainColor(domain.name).b}, ${Math.min(1, 0.35 + domain.completion * 0.65)})`,
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
                  Ikigai values
                </p>
                {ikigaiAlignment.every((v) => v.planned === 0) ? (
                  <p className="text-xs text-mutedText">No data for this week.</p>
                ) : (
                  ikigaiAlignment.map((value) => (
                    <div
                      key={value.id}
                      className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-2 text-xs text-mutedText sm:items-center">
                        <span className="font-medium text-text flex-shrink-0 min-w-0 truncate">{value.label}</span>
                        <span className="flex-shrink-0 whitespace-nowrap">
                          {Math.round(value.completed)}h · {Math.round(value.planned)}h
                        </span>
                      </div>
                      <div className="mt-3 h-3 w-full rounded-full bg-slate-100">
                        <div className="h-3 rounded-full bg-accentSoft" style={{ width: '100%' }} />
                        <div
                          className="mt-[-12px] h-3 rounded-full"
                          style={{
                            width: `${Math.min(100, Math.round(value.completion * 100))}%`,
                            backgroundColor: `rgba(${IKIGAI_COLORS[value.id].r}, ${IKIGAI_COLORS[value.id].g}, ${IKIGAI_COLORS[value.id].b}, ${Math.min(1, 0.35 + value.completion * 0.65)})`,
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Reflections — selected week */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-text">Reflections</h2>
                <p className="mt-1 text-xs text-mutedText">
                  {selectedSummary?.weekId === currentWeekId
                    ? 'This week'
                    : (selectedSummary?.rangeLabel ?? 'Selected week')}
                </p>
              </div>
              <Link
                href={selectedSummary ? `/week/${encodeURIComponent(selectedSummary.weekId)}` : '/reflect'}
                className="text-xs text-mutedText hover:text-text shrink-0"
              >
                {selectedSummary?.weekId === currentWeekId ? 'Add note →' : 'View week →'}
              </Link>
            </div>
            {selectedWeekNotes.length === 0 ? (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-mutedText">
                No reflections for this week yet.
              </div>
            ) : (
              <ol
                className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1"
                data-testid="reflection-week-list"
              >
                {selectedWeekNotes.map((note, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-text"
                  >
                    {note.emoji ? (
                      <span className="mr-1.5">{note.emoji}</span>
                    ) : null}
                    {note.categoryId === 'check_in' ? (
                      <span className="mr-1.5 rounded-full bg-accentSoft px-1.5 py-0.5 text-[10px] text-accent">
                        check-in
                      </span>
                    ) : null}
                    {note.text}
                  </li>
                ))}
              </ol>
            )}
            {reflectionWeeks.length > 0 && (
              <Link
                href="/reflect?view=history"
                className="mt-3 block text-[11px] text-mutedText hover:text-text"
              >
                Browse all {reflectionWeeks.length} weeks with notes →
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-surface p-4 sm:p-6 shadow-sm">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text">
                Consistency highlights
              </h2>
              <p className="mt-1 text-xs text-mutedText">
                Based on your complete history — not just the selected week.
              </p>
            </div>
            <div className="hidden text-[11px] text-mutedText sm:block">
              Richer green = steadier
            </div>
          </div>
          {domainInsights.length === 0 ? (
            <p className="mt-4 text-xs text-mutedText">
              Log a few weeks to see consistency patterns.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {domainInsights.map((domain) => (
                <div
                  key={domain.domainName}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-2 sm:items-center">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-emerald-900 flex-shrink-0"
                      style={{
                        backgroundColor: `rgba(16, 185, 129, ${0.18 + domain.consistencyScore * 0.52})`,
                      }}
                    >
                      {domain.domainName}
                    </span>
                    <span className="text-mutedText font-medium flex-shrink-0">
                      {Math.round(domain.avg * 100)}%
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-mutedText">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      {domain.consistency}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      {domain.trend}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-white">
                    <div
                      className="h-1.5 rounded-full bg-slate-400"
                      style={{ width: `${Math.round(domain.consistencyScore * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
