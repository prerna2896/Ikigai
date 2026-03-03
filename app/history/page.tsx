'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Settings, WeekLogEntry, WeekNote, WeekPlan } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import { getWeekEndISO, withDerivedPlannedHours } from '../week/plan/planUtils';

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

const getDomainColor = (name: string) => {
  const color = domainPalette[hashString(name) % domainPalette.length];
  return color ?? domainPalette[0];
};

const seededRatio = (seed: string, min = 0.6, max = 1.1) => {
  const hash = hashString(seed);
  const ratio = (hash % 1000) / 1000;
  return min + ratio * (max - min);
};

const buildFakeLog = (plan: WeekPlan, seed: string): WeekLogEntry | null => {
  const taskHours: Record<string, number> = {};
  const tasks = plan.domains.flatMap((domain) => domain.tasks);
  if (tasks.length === 0) {
    return null;
  }
  tasks.forEach((task) => {
    const ratio = seededRatio(`${seed}-${task.id}`);
    const hours = Math.max(0, Math.round(task.plannedHours * ratio));
    taskHours[task.id] = hours;
  });
  const dateISO = new Date(`${plan.weekEndISO}T18:00:00`).toISOString();
  return {
    id: crypto.randomUUID(),
    weekId: plan.id,
    dateISO,
    taskHours,
    createdAt: dateISO,
    updatedAt: dateISO,
  };
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

const seedHistoryIfNeeded = async (
  repo: ReturnType<typeof getLocalRepository>,
  settingsRecord: Settings,
  plans: WeekPlan[],
) => {
  if (plans.length === 0 || plans.length >= 4) {
    return;
  }
  const sorted = [...plans].sort((a, b) =>
    a.weekStartISO < b.weekStartISO ? 1 : -1,
  );
  const latest = sorted[0];
  const basePlan = withDerivedPlannedHours(latest);
  const existingStarts = new Set(plans.map((plan) => plan.weekStartISO));
  const timeZone = settingsRecord.weekTimeZone || 'UTC';
  const weekStartDay = settingsRecord.weekStartDay || 'sunday';
  for (let offset = 1; offset <= 3; offset += 1) {
    const startISO = addDaysISO(latest.weekStartISO, -7 * offset);
    if (existingStarts.has(startISO)) {
      continue;
    }
    const endISO = getWeekEndISO(startISO);
    const createdAtISO = new Date().toISOString();
    const clonedDomains = basePlan.domains.map((domain) => ({
      ...domain,
      tasks: domain.tasks.map((task) => ({ ...task })),
    }));
    const plan: WeekPlan = {
      ...basePlan,
      id: startISO,
      weekStartISO: startISO,
      weekEndISO: endISO,
      weekStartDay,
      weekTimeZone: timeZone,
      createdAtISO,
      domains: clonedDomains,
      isFrozen: true,
    };
    await repo.saveWeekPlan(plan);
    const firstLog = buildFakeLog(plan, `seed-${startISO}-a`);
    const secondLog = buildFakeLog(plan, `seed-${startISO}-b`);
    if (firstLog) {
      await repo.saveWeekLog(firstLog);
    }
    if (secondLog) {
      await repo.saveWeekLog(secondLog);
    }
    await repo.saveWeekNote({
      id: crypto.randomUUID(),
      weekId: plan.id,
      note: `Quick note for ${formatRange(plan, timeZone)}: this week felt steady in spots, uneven in others.`,
      createdAt: createdAtISO,
      updatedAt: createdAtISO,
    });
  }
};

export default function HistoryPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weekPlans, setWeekPlans] = useState<WeekPlan[]>([]);
  const [weekLogsByWeek, setWeekLogsByWeek] = useState<
    Record<string, WeekLogEntry[]>
  >({});
  const [weekNote, setWeekNote] = useState<WeekNote | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [selectedHistoryWeekId, setSelectedHistoryWeekId] = useState<string | null>(
    null,
  );
  const [showSavedNote, setShowSavedNote] = useState(false);

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      Promise.all([repo.getSettings(), repo.listWeekPlans()])
        .then(async ([settingsRecord, plans]) => {
          setSettings(settingsRecord);
          if (plans.length === 0) {
            setWeekPlans([]);
            setWeekLogsByWeek({});
            return;
          }
          await seedHistoryIfNeeded(repo, settingsRecord, plans);
          const refreshedPlans = await repo.listWeekPlans();
          const sorted = [...refreshedPlans].sort((a, b) =>
            a.weekStartISO < b.weekStartISO ? 1 : -1,
          );
          setWeekPlans(sorted);
          const logsByWeek: Record<string, WeekLogEntry[]> = {};
          await Promise.all(
            sorted.map(async (plan) => {
              const logs = await repo.getWeekLogs(plan.id);
              logsByWeek[plan.id] = [...logs].sort((a, b) =>
                a.dateISO < b.dateISO ? 1 : -1,
              );
            }),
          );
          setWeekLogsByWeek(logsByWeek);
          const currentId = sorted[0].id;
          setSelectedHistoryWeekId((prev) => prev ?? currentId);
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, []);

  useEffect(() => {
    if (!selectedHistoryWeekId) {
      return;
    }
    setShowSavedNote(false);
    try {
      const repo = getLocalRepository();
      repo
        .getWeekNote(selectedHistoryWeekId)
        .then((note) => {
          setWeekNote(note);
          setNoteDraft(note?.note ?? '');
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, [selectedHistoryWeekId]);

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
      .slice(0, 6)
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
          completedTotal,
          adherence:
            plannedTotal > 0 ? completedTotal / plannedTotal : 0,
          domainTotals,
        };
      });
  }, [weekPlans, weekLogsByWeek, timeZone]);

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

  const overallAdherence = useMemo(() => {
    if (!historySummaries.length) {
      return 0;
    }
    const total = historySummaries.reduce((sum, summary) => sum + summary.adherence, 0);
    return total / historySummaries.length;
  }, [historySummaries]);

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
    const ordered = historySummaries.slice().reverse();
    const points = ordered.map((summary, index) => ({
      index,
      label: summary.rangeLabel,
      planned: summary.plannedTotal,
      completed: summary.completedTotal,
    }));
    const maxHours = points.reduce(
      (max, point) => Math.max(max, point.planned, point.completed),
      0,
    );
    return { points, maxHours };
  }, [historySummaries]);

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

  const handleSaveNote = async () => {
    if (!selectedSummary) {
      return;
    }
    try {
      const repo = getLocalRepository();
      setIsSavingNote(true);
      const nowIso = new Date().toISOString();
      const entry: WeekNote = {
        id: weekNote?.id ?? crypto.randomUUID(),
        weekId: selectedSummary.weekId,
        note: noteDraft.trim(),
        createdAt: weekNote?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
      await repo.saveWeekNote(entry);
      setWeekNote(entry);
      setShowSavedNote(true);
      setStatus('Note saved.');
      window.setTimeout(() => setStatus(null), 1500);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setIsSavingNote(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
            History
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs text-mutedText hover:text-text"
          >
            <span className="text-base" aria-hidden="true">
              ⌂
            </span>
            Home
          </Link>
        </div>
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

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Follow-through
            </p>
            <p className="mt-2 text-2xl font-semibold text-text">
              {Math.round(overallAdherence * 100)}%
            </p>
            <p className="text-xs text-mutedText">
              Average of planned vs. logged.
            </p>
            <div className="mt-3 h-2 w-full rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-accent"
                style={{ width: `${Math.round(overallAdherence * 100)}%` }}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Steadiest domain
            </p>
            <p className="mt-2 text-lg font-semibold text-text">
              {mostSteadyDomain?.domainName ?? '—'}
            </p>
            <p className="text-xs text-mutedText">
              {mostSteadyDomain
                ? `${Math.round(mostSteadyDomain.avg * 100)}% avg`
                : 'No data yet.'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Often underplanned
            </p>
            <p className="mt-2 text-lg font-semibold text-text">
              {mostUndercommitted?.domainName ?? '—'}
            </p>
            <p className="text-xs text-mutedText">
              {mostUndercommitted
                ? `${Math.round(mostUndercommitted.avg * 100)}% avg`
                : 'No pattern yet.'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Often overplanned
            </p>
            <p className="mt-2 text-lg font-semibold text-text">
              {mostOvercommitted?.domainName ?? '—'}
            </p>
            <p className="text-xs text-mutedText">
              {mostOvercommitted
                ? `${Math.round(mostOvercommitted.avg * 100)}% avg`
                : 'No pattern yet.'}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text">
                  Weekly time series
                </h2>
                <span className="text-xs text-mutedText">
                  All recent weeks
                </span>
              </div>
              <p className="mt-1 text-xs text-mutedText">
                Planned vs. completed hours across the past weeks.
              </p>
              {weeklySeries.points.length ? (
                <>
                  <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <svg
                      viewBox="0 0 520 180"
                      className="h-40 w-full"
                      role="img"
                      aria-label="Weekly planned versus completed hours"
                    >
                      <defs>
                        <linearGradient id="plannedLine" x1="0" x2="1">
                          <stop offset="0%" stopColor="#a7b8b3" />
                          <stop offset="100%" stopColor="#7f9f97" />
                        </linearGradient>
                        <linearGradient id="completedLine" x1="0" x2="1">
                          <stop offset="0%" stopColor="#7c8aa5" />
                          <stop offset="100%" stopColor="#5f6f8f" />
                        </linearGradient>
                      </defs>
                      {(() => {
                        const paddingX = 28;
                        const paddingY = 20;
                        const width = 520 - paddingX * 2;
                        const height = 180 - paddingY * 2;
                        const maxValue = Math.max(weeklySeries.maxHours, 1);
                        const step =
                          weeklySeries.points.length > 1
                            ? width / (weeklySeries.points.length - 1)
                            : 0;
                        const plannedPoints = weeklySeries.points
                          .map((point, index) => {
                            const x = paddingX + index * step;
                            const y =
                              paddingY +
                              (1 - point.planned / maxValue) * height;
                            return `${x},${y}`;
                          })
                          .join(' ');
                        const completedPoints = weeklySeries.points
                          .map((point, index) => {
                            const x = paddingX + index * step;
                            const y =
                              paddingY +
                              (1 - point.completed / maxValue) * height;
                            return `${x},${y}`;
                          })
                          .join(' ');
                        return (
                          <>
                            <line
                              x1={paddingX}
                              y1={paddingY + height}
                              x2={paddingX + width}
                              y2={paddingY + height}
                              stroke="#e2e8f0"
                              strokeWidth="1"
                            />
                            <polyline
                              fill="none"
                              stroke="url(#plannedLine)"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={plannedPoints}
                            />
                            <polyline
                              fill="none"
                              stroke="url(#completedLine)"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={completedPoints}
                            />
                            {weeklySeries.points.map((point, index) => {
                              const x = paddingX + index * step;
                              const plannedY =
                                paddingY +
                                (1 - point.planned / maxValue) * height;
                              const completedY =
                                paddingY +
                                (1 - point.completed / maxValue) * height;
                              return (
                                <g key={`${point.label}-${index}`}>
                                  <circle
                                    cx={x}
                                    cy={plannedY}
                                    r="3"
                                    fill="#7f9f97"
                                  />
                                  <circle
                                    cx={x}
                                    cy={completedY}
                                    r="3"
                                    fill="#5f6f8f"
                                  />
                                </g>
                              );
                            })}
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-mutedText">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#7f9f97]" />
                      Planned hours
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#5f6f8f]" />
                      Completed hours
                    </span>
                  </div>
                </>
              ) : (
                <p className="mt-4 text-xs text-mutedText">
                  Add a few weeks of logs to see the shape.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text">
                  Weekly adherence
                </h2>
                <span className="text-xs text-mutedText">Planned vs. logged</span>
              </div>
              <div className="mt-4 space-y-3">
                {historySummaries.map((summary) => {
                  const ratio = Math.min(
                    1,
                    summary.plannedTotal > 0
                      ? summary.completedTotal / summary.plannedTotal
                      : 0,
                  );
                  const isSelected = selectedSummary?.weekId === summary.weekId;
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
                        <span className="font-medium text-text">
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
                  })}
              </div>
              {bestWeek ? (
                <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-mutedText">
                  Best alignment: {bestWeek.rangeLabel} ·{' '}
                  {Math.round(bestWeek.adherence * 100)}%
                </div>
              ) : null}
              {weakestWeek ? (
                <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-mutedText">
                  Most drift: {weakestWeek.rangeLabel} ·{' '}
                  {Math.round(weakestWeek.adherence * 100)}%
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-text">
                    Domain breakdown
                  </h2>
                  <p className="mt-1 text-xs text-mutedText">
                    Planned share and completion for{' '}
                    {selectedSummary?.rangeLabel ?? 'this week'}.
                  </p>
                </div>
                <div className="hidden items-center gap-3 text-[11px] text-mutedText sm:flex">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-accentSoft" />
                    Planned share
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    Completed
                  </span>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {selectedSummary ? (
                  Object.entries(selectedSummary.domainTotals).map(
                    ([domainName, totals]) => {
                      const ratio =
                        totals.planned > 0
                          ? Math.min(1, totals.completed / totals.planned)
                          : 0;
                      const plannedShare =
                        selectedSummary.plannedTotal > 0
                          ? Math.min(1, totals.planned / selectedSummary.plannedTotal)
                          : 0;
                      return (
                        <div
                          key={domainName}
                          className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mutedText">
                            <span className="font-medium text-text">
                              {domainName}
                            </span>
                            <span>
                              {Math.round(totals.completed)}h completed ·{' '}
                              {Math.round(totals.planned)}h planned
                            </span>
                          </div>
                          <div className="mt-3 h-3 w-full rounded-full bg-white">
                            <div
                              className="h-3 rounded-full bg-accentSoft"
                              style={{ width: `${Math.round(plannedShare * 100)}%` }}
                            />
                            <div
                              className="mt-[-12px] h-3 rounded-full bg-slate-400"
                              style={{ width: `${Math.round(ratio * 100)}%` }}
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] text-mutedText">
                            <span>{Math.round(plannedShare * 100)}% of plan</span>
                            <span>{Math.round(ratio * 100)}% completed</span>
                          </div>
                        </div>
                      );
                    },
                  )
                ) : (
                  <p className="text-xs text-mutedText">No history yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-text">
                    Consistency highlights
                  </h2>
                  <p className="mt-1 text-xs text-mutedText">
                    A gentle read on where things stayed most steady.
                  </p>
                </div>
                <div className="hidden text-[11px] text-mutedText sm:block">
                  Richer green = steadier
                </div>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {domainInsights.map((domain) => (
                  <div
                    key={domain.domainName}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium text-emerald-900"
                        style={{
                          backgroundColor: `rgba(16, 185, 129, ${
                            0.18 + domain.consistencyScore * 0.52
                          })`,
                        }}
                      >
                        {domain.domainName}
                      </span>
                      <span className="text-mutedText">
                        {Math.round(domain.avg * 100)}%
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-mutedText">
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
                        style={{
                          width: `${Math.round(domain.consistencyScore * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-text">Notes</h2>
                  <p className="mt-1 text-xs text-mutedText">
                    Capture context for this week’s report.
                  </p>
                </div>
                {weekNote?.note ? (
                  <button
                    type="button"
                    className="text-xs text-mutedText hover:text-text"
                    onClick={() => setShowSavedNote((prev) => !prev)}
                  >
                    {showSavedNote ? 'Hide note' : 'View note'}
                  </button>
                ) : null}
              </div>
              {isCurrentWeek ? (
                <>
                  <textarea
                    className="mt-4 h-40 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-text"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Anything to remember about this week?"
                  />
                  <button
                    type="button"
                    className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-text disabled:opacity-60"
                    onClick={handleSaveNote}
                    disabled={isSavingNote}
                  >
                    {isSavingNote ? 'Saving…' : 'Save note'}
                  </button>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-mutedText">
                  Notes live in the current week. Past weeks stay in the archive.
                </div>
              )}
              {showSavedNote && weekNote?.note ? (
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-text">
                  {weekNote.note}
                </div>
              ) : null}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-text">Key signals</h2>
              <p className="mt-1 text-xs text-mutedText">
                Quick takeaways based on recent weeks.
              </p>
              <div className="mt-4 space-y-3 text-xs text-mutedText">
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  {mostSteadyDomain
                    ? `${mostSteadyDomain.domainName} stayed the most steady.`
                    : 'No steady domain yet.'}
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  {mostUndercommitted
                    ? `${mostUndercommitted.domainName} often needed more time than planned.`
                    : 'No consistent under-commitment yet.'}
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  {mostOvercommitted
                    ? `${mostOvercommitted.domainName} is often overestimated.`
                    : 'No consistent over-commitment yet.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
