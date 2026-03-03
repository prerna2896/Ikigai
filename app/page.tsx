'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Settings, WeekLogEntry, WeekPlan } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import IkigaiWheelPlot from '../components/IkigaiWheelPlot';
import IkigaiPrinciplesPlot, {
  getPrincipleForDomain,
  type IkigaiPrincipleId,
} from '../components/IkigaiPrinciplesPlot';
import { addDomainToPlan, withDerivedPlannedHours } from './week/plan/planUtils';

type WeekStatus = 'upcoming' | 'mid' | 'end' | 'stale';

type LogFormState = Record<string, string>;

const formatHoursInput = (value: string) =>
  value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');

const parseHours = (value: string) => {
  const cleaned = formatHoursInput(value);
  if (cleaned === '') {
    return 0;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
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

const toLocalDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const getDomainIcon = (domainName: string) => {
  const key = domainName.toLowerCase();
  if (key.includes('work') || key.includes('study')) return '💼';
  if (key.includes('health')) return '🫁';
  if (key.includes('home') || key.includes('life')) return '🏠';
  if (key.includes('relationship')) return '🤝';
  if (key.includes('growth')) return '🌱';
  if (key.includes('rest') || key.includes('recharge')) return '🫧';
  return '•';
};

export default function HomePage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [weekLogs, setWeekLogs] = useState<WeekLogEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [logForm, setLogForm] = useState<LogFormState>({});
  const [isSavingLog, setIsSavingLog] = useState(false);
  const [plotMode, setPlotMode] = useState<'domains' | 'ikigai'>('domains');
  const [selectedPrincipleId, setSelectedPrincipleId] =
    useState<IkigaiPrincipleId | null>(null);
  const [unplannedTitle, setUnplannedTitle] = useState('');
  const [unplannedHours, setUnplannedHours] = useState('1');
  const [unplannedDomainId, setUnplannedDomainId] = useState<string | null>(null);
  const [unplannedTasks, setUnplannedTasks] = useState<
    { title: string; hours: number; domainId: string }[]
  >([]);
  const [newUnplannedDomainName, setNewUnplannedDomainName] = useState('');

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      Promise.all([repo.getSettings(), repo.listWeekPlans()])
        .then(async ([settingsRecord, plans]) => {
          setSettings(settingsRecord);
          if (plans.length === 0) {
            setWeekPlan(null);
            setWeekLogs([]);
            return;
          }
          const sorted = [...plans].sort((a, b) =>
            a.weekStartISO < b.weekStartISO ? 1 : -1,
          );
          const latest = sorted[0];
          const normalized = withDerivedPlannedHours(latest);
          setWeekPlan(normalized);
          const logs = await repo.getWeekLogs(normalized.id);
          const orderedLogs = [...logs].sort((a, b) =>
            a.dateISO < b.dateISO ? 1 : -1,
          );
          setWeekLogs(orderedLogs);
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, []);

  const timeZone =
    settings?.weekTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const weekRangeLabel = useMemo(() => {
    if (!weekPlan) {
      return null;
    }
    return formatRange(weekPlan, timeZone);
  }, [weekPlan, timeZone]);

  const weekStatus = useMemo<WeekStatus | null>(() => {
    if (!weekPlan) {
      return null;
    }
    const today = startOfToday();
    const start = toLocalDate(weekPlan.weekStartISO);
    const end = toLocalDate(weekPlan.weekEndISO);
    if (today < start) {
      return 'upcoming';
    }
    if (today >= start && today <= end) {
      const daysToEnd = Math.floor(
        (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      return daysToEnd <= 1 ? 'end' : 'mid';
    }
    const daysSinceEnd = Math.floor(
      (today.getTime() - end.getTime()) / (1000 * 60 * 60 * 24),
    );
    return daysSinceEnd > 7 ? 'stale' : 'end';
  }, [weekPlan]);

  const lastLog = weekLogs[0] ?? null;
  const lastLogDate = lastLog
    ? new Date(lastLog.dateISO).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone,
      })
    : null;

  const lastLogTotal = lastLog
    ? Object.values(lastLog.taskHours).reduce((sum, hours) => sum + hours, 0)
    : 0;

  const weekTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    weekLogs.forEach((log) => {
      Object.entries(log.taskHours).forEach(([taskId, hours]) => {
        totals[taskId] = (totals[taskId] || 0) + hours;
      });
    });
    return totals;
  }, [weekLogs]);

  const tasksForLog = useMemo(() => {
    if (!weekPlan) {
      return [];
    }
    const tasks = weekPlan.domains.flatMap((domain) =>
      domain.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        plannedHours: task.plannedHours,
        domainName: domain.name,
      })),
    );
    return tasks.sort((a, b) => b.plannedHours - a.plannedHours);
  }, [weekPlan]);

  const principleTasks = useMemo(() => {
    if (!weekPlan || !selectedPrincipleId) {
      return [] as { id: string; title: string; hours: number; domainName: string }[];
    }
    const tasks = weekPlan.domains.flatMap((domain) =>
      getPrincipleForDomain(domain.name) === selectedPrincipleId
        ? domain.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            hours: task.plannedHours,
            domainName: domain.name,
          }))
        : [],
    );
    return tasks.sort((a, b) => b.hours - a.hours);
  }, [weekPlan, selectedPrincipleId]);

  useEffect(() => {
    if (!weekPlan) {
      return;
    }
    if (weekStatus === 'end') {
      const nextState: LogFormState = {};
      tasksForLog.forEach((task) => {
        nextState[task.id] = logForm[task.id] ?? '0';
      });
      setLogForm(nextState);
    }
  }, [weekPlan, weekStatus, tasksForLog]);

  useEffect(() => {
    if (weekPlan && weekPlan.domains.length && !unplannedDomainId) {
      setUnplannedDomainId(weekPlan.domains[0]?.id ?? null);
    }
  }, [weekPlan, unplannedDomainId]);

  const handleLogChange = (taskId: string, value: string) => {
    setLogForm((prev) => ({ ...prev, [taskId]: formatHoursInput(value) }));
  };

  const handleAddUnplannedTask = () => {
    const trimmedTitle = unplannedTitle.trim();
    const extraHours = parseHours(unplannedHours);
    if (!trimmedTitle || extraHours <= 0 || !unplannedDomainId) {
      return;
    }
    setUnplannedTasks((prev) => [
      ...prev,
      { title: trimmedTitle, hours: extraHours, domainId: unplannedDomainId },
    ]);
    setUnplannedTitle('');
    setUnplannedHours('1');
  };

  const handleAddUnplannedDomain = async () => {
    if (!weekPlan) {
      return;
    }
    const trimmed = newUnplannedDomainName.trim();
    if (!trimmed || weekPlan.domains.length >= 7) {
      return;
    }
    try {
      const repo = getLocalRepository();
      const { plan, domain } = addDomainToPlan(weekPlan, trimmed);
      const normalized = withDerivedPlannedHours(plan);
      await repo.saveWeekPlan(normalized);
      setWeekPlan(normalized);
      setUnplannedDomainId(domain.id);
      setNewUnplannedDomainName('');
    } catch (error) {
      setStatus(String(error));
    }
  };

  const handleSaveLog = async () => {
    if (!weekPlan || !settings) {
      return;
    }
    try {
      const repo = getLocalRepository();
      setIsSavingLog(true);
      const nowIso = new Date().toISOString();
      const taskHours: Record<string, number> = {};
      tasksForLog.forEach((task) => {
        const raw = logForm[task.id] ?? '';
        if (raw !== '' || weekStatus === 'end') {
          taskHours[task.id] = parseHours(raw);
        }
      });
      let updatedPlan = weekPlan;
      if (unplannedTasks.length > 0) {
        const nowIso = new Date().toISOString();
        const newTasks = unplannedTasks.map((task) => ({
          id: crypto.randomUUID(),
          title: task.title,
          plannedHours: 0,
          domainId: task.domainId,
          hours: task.hours,
        }));
        updatedPlan = {
          ...weekPlan,
          domains: weekPlan.domains.map((domain) => {
            const additions = newTasks
              .filter((task) => task.domainId === domain.id)
              .map((task) => ({
                id: task.id,
                title: task.title,
                plannedHours: 0,
              }));
            if (additions.length === 0) {
              return domain;
            }
            return {
              ...domain,
              tasks: [...domain.tasks, ...additions],
            };
          }),
          createdAtISO: weekPlan.createdAtISO ?? nowIso,
        };
        newTasks.forEach((task) => {
          taskHours[task.id] = task.hours;
        });
        const normalized = withDerivedPlannedHours(updatedPlan);
        await repo.saveWeekPlan(normalized);
        setWeekPlan(normalized);
      }
      const entry: WeekLogEntry = {
        id: crypto.randomUUID(),
        weekId: weekPlan.id,
        dateISO: nowIso,
        taskHours,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await repo.saveWeekLog(entry);
      const logs = await repo.getWeekLogs(weekPlan.id);
      const orderedLogs = [...logs].sort((a, b) =>
        a.dateISO < b.dateISO ? 1 : -1,
      );
      setWeekLogs(orderedLogs);
      setLogForm({});
      setUnplannedTitle('');
      setUnplannedHours('1');
      setUnplannedTasks([]);
      setStatus('Logged for today.');
      window.setTimeout(() => setStatus(null), 1500);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setIsSavingLog(false);
    }
  };


  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Ikigai
        </p>
        <h1 className="text-3xl font-semibold text-text">
          A calm place to plan and reflect on your week.
        </h1>
        <p className="text-base text-mutedText">
          Plan gently, log lightly, and notice patterns over time.
        </p>
        {status ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {status}
          </div>
        ) : null}
      </header>
      <section
        className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
        data-testid="home-tabs"
      >
        <h2 className="text-lg font-medium text-text">Start here</h2>
        <p className="mt-2 text-sm text-mutedText">
          A few calm steps to make this space feel like yours.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            className="inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-white"
            href="/onboarding/context"
            data-testid="home-tab-get-started"
          >
            Get started
          </Link>
          <Link
            className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-text"
            href="/week/plan"
            data-testid="home-tab-planning"
          >
            Go to planning
          </Link>
          <Link
            className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-text"
            href="/profile"
            data-testid="home-tab-profile"
          >
            Open profile
          </Link>
          <Link
            className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-text"
            href="/history"
            data-testid="home-tab-history"
          >
            View history
          </Link>
          <Link
            className="inline-flex items-center rounded-full border border-slate-200 bg-accentSoft px-4 py-2 text-sm font-medium text-text"
            href="/dev/db"
          >
            DB Playground (dev)
          </Link>
        </div>
        <p className="mt-3 text-xs text-mutedText">
          Dev tools are optional and for local testing only.
        </p>
      </section>
      {weekPlan ? (
        <section
          className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
          data-testid="latest-week"
        >
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Latest week
            </p>
            {weekRangeLabel ? (
              <p className="text-sm text-mutedText">{weekRangeLabel}</p>
            ) : null}
          </div>
          <div className="mt-4 flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1 text-xs text-mutedText">
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  plotMode === 'domains'
                    ? 'bg-accent text-white'
                    : 'text-mutedText'
                }`}
                onClick={() => {
                  setPlotMode('domains');
                  setSelectedPrincipleId(null);
                }}
              >
                Domains
              </button>
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  plotMode === 'ikigai'
                    ? 'bg-accent text-white'
                    : 'text-mutedText'
                }`}
                onClick={() => {
                  setPlotMode('ikigai');
                  setSelectedPrincipleId(null);
                }}
              >
                Ikigai
              </button>
            </div>
            {plotMode === 'ikigai' ? (
              <p className="text-xs text-mutedText">
                Domains are grouped into Energy, Growth, Contribution, and Alignment.
              </p>
            ) : null}
            {plotMode === 'domains' ? (
              <IkigaiWheelPlot
                domains={weekPlan.domains}
                onSelectDomain={() => {}}
                showSkeleton={weekPlan.domains.length === 0}
              />
            ) : (
              <IkigaiPrinciplesPlot
                domains={weekPlan.domains}
                activePrincipleId={selectedPrincipleId}
                onSelectPrinciple={(principleId) =>
                  setSelectedPrincipleId(principleId)
                }
              />
            )}
            {plotMode === 'ikigai' ? (
              <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-text">
                    {selectedPrincipleId
                      ? `${selectedPrincipleId} tasks`.replace(
                          /(^|\s)\S/g,
                          (letter) => letter.toUpperCase(),
                        )
                      : 'Ikigai tasks'}
                  </p>
                  {selectedPrincipleId ? (
                    <button
                      type="button"
                      className="text-xs text-mutedText hover:text-text"
                      onClick={() => setSelectedPrincipleId(null)}
                    >
                      Back to principles
                    </button>
                  ) : null}
                </div>
                {selectedPrincipleId ? (
                  principleTasks.length === 0 ? (
                    <p className="mt-3 text-xs text-mutedText">
                      No tasks under this principle yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {principleTasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs text-mutedText"
                        >
                          <span className="text-text">{task.title}</span>
                          <span>
                            {task.hours}h · {task.domainName}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="mt-3 text-xs text-mutedText">
                    Tap a principle in the plot to see its tasks.
                  </p>
                )}
              </div>
            ) : null}
            <div className="text-center text-xs text-mutedText">
              This is the latest plan saved for the week.
            </div>
          </div>
          {weekStatus === 'stale' ? (
            <div className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-text">
                Your last plan is from a while ago.
              </p>
              <p className="text-xs text-mutedText">
                You can finish logging that week or start a new plan for the
                upcoming week.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-text"
                  onClick={() => {
                    document.getElementById('week-log')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                  }}
                >
                  Log last week
                </button>
                <Link
                  className="inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-white"
                  href="/week/plan"
                >
                  Create a new plan
                </Link>
              </div>
            </div>
          ) : null}
          {weekStatus && weekStatus !== 'upcoming' ? (
            <div
              id="week-log"
              className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="space-y-2">
                <p className="text-sm font-medium text-text">
                  {weekStatus === 'end'
                    ? 'Wrap up the week'
                    : 'Log time since your last check-in'}
                </p>
                <p className="text-xs text-mutedText">
                  {weekStatus === 'end'
                    ? 'Add hours for each task. It’s okay if some are zero.'
                    : 'A quick update keeps the picture current.'}
                </p>
                {lastLogDate ? (
                  <p className="text-xs text-mutedText">
                    Last entry: {lastLogDate} · {Math.round(lastLogTotal)}h logged
                  </p>
                ) : null}
              </div>
              <div className="space-y-3">
                {tasksForLog.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-text"
                  >
                    <div className="flex min-w-[160px] flex-1 items-center gap-3">
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-base"
                        title={task.domainName}
                        aria-label={task.domainName}
                      >
                        {getDomainIcon(task.domainName)}
                      </span>
                      <span className="font-medium">{task.title}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-mutedText">
                      <div className="flex items-center gap-2">
                        <span className="text-mutedText">Planned</span>
                        <span className="font-medium text-text">
                          {Math.round(task.plannedHours)}h
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-mutedText">Completed</span>
                        <span className="font-medium text-text">
                          {Math.round(weekTotals[task.id] || 0)}h
                        </span>
                      </div>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                      value={logForm[task.id] ?? ''}
                      onChange={(event) =>
                        handleLogChange(task.id, event.target.value)
                      }
                      placeholder="0"
                    />
                  </div>
                ))}
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-mutedText">
                  <p className="text-sm font-medium text-text">
                    Log something unplanned
                  </p>
                  <p className="mt-1 text-xs text-mutedText">
                    Add completed tasks that weren’t on the plan.
                  </p>
                  {unplannedTasks.length > 0 ? (
                    <div className="mt-3 space-y-2 text-xs text-mutedText">
                      {unplannedTasks.map((task, index) => {
                        const domainName =
                          weekPlan?.domains.find((domain) => domain.id === task.domainId)
                            ?.name ?? 'Domain';
                        return (
                          <div
                            key={`${task.title}-${index}`}
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
                          >
                            <span className="text-text">{task.title}</span>
                            <span>
                              {task.hours}h · {domainName}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input
                      type="text"
                      className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                      value={unplannedTitle}
                      onChange={(event) => setUnplannedTitle(event.target.value)}
                      placeholder="Task name"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                      value={unplannedHours}
                      onChange={(event) =>
                        setUnplannedHours(formatHoursInput(event.target.value))
                      }
                      placeholder="Hours"
                    />
                    <select
                      className="min-w-[160px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-text"
                      value={unplannedDomainId ?? ''}
                      onChange={(event) => setUnplannedDomainId(event.target.value)}
                    >
                      {weekPlan?.domains.map((domain) => (
                        <option key={domain.id} value={domain.id}>
                          {domain.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-text"
                      onClick={handleAddUnplannedTask}
                    >
                      Add unplanned
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input
                      type="text"
                      className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                      value={newUnplannedDomainName}
                      onChange={(event) => setNewUnplannedDomainName(event.target.value)}
                      placeholder="New domain name"
                    />
                    <button
                      type="button"
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-text"
                      onClick={() => void handleAddUnplannedDomain()}
                      disabled={!weekPlan || weekPlan.domains.length >= 7}
                    >
                      Add domain
                    </button>
                    {weekPlan && weekPlan.domains.length >= 7 ? (
                      <span className="text-[11px] text-mutedText">
                        Max 7 domains
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] text-mutedText">
                    Save log records everything at once.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                onClick={handleSaveLog}
                disabled={isSavingLog || tasksForLog.length === 0}
              >
                {isSavingLog ? 'Saving…' : 'Save log'}
              </button>
              {Object.keys(weekTotals).length > 0 ? (
                <p className="text-xs text-mutedText">
                  Week total so far: {Math.round(
                    Object.values(weekTotals).reduce((sum, hours) => sum + hours, 0),
                  )}h
                </p>
              ) : null}
            </div>
          ) : weekStatus === 'upcoming' ? (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs text-mutedText">
              The week hasn’t started yet. You can update the plan anytime.
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-medium text-text">No plan yet</h2>
          <p className="mt-2 text-sm text-mutedText">
            Start onboarding to set up a week, or jump into planning.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              className="inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-white"
              href="/onboarding/context"
            >
              Get started
            </Link>
            <Link
              className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-text"
              href="/week/plan"
            >
              Go to planning
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
