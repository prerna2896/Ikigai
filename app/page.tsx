'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Settings, WeekLogEntry, WeekPlan } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import IkigaiWheelPlot from '../components/IkigaiWheelPlot';
import { withDerivedPlannedHours } from './week/plan/planUtils';

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

export default function HomePage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [weekLogs, setWeekLogs] = useState<WeekLogEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [logForm, setLogForm] = useState<LogFormState>({});
  const [isSavingLog, setIsSavingLog] = useState(false);

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
          const logs = await repo.getWeekLogs(latest.id);
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

  const handleLogChange = (taskId: string, value: string) => {
    setLogForm((prev) => ({ ...prev, [taskId]: formatHoursInput(value) }));
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
          This build focuses on the data layer foundation and local-first
          persistence.
        </p>
        {status ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {status}
          </div>
        ) : null}
      </header>
      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-medium text-text">Start here</h2>
        <p className="mt-2 text-sm text-mutedText">
          A few calm steps to make this space feel like yours.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            className="inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-white"
            href="/onboarding/name"
          >
            Get started
          </Link>
          <Link
            className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-text"
            href="/week/plan"
          >
            Go to planning
          </Link>
          <Link
            className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-text"
            href="/profile"
          >
            Open profile
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
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Latest week
            </p>
            {weekRangeLabel ? (
              <p className="text-sm text-mutedText">{weekRangeLabel}</p>
            ) : null}
          </div>
          <div className="mt-4 flex flex-col items-center gap-4">
            <IkigaiWheelPlot
              domains={weekPlan.domains}
              onSelectDomain={() => {}}
              showSkeleton={weekPlan.domains.length === 0}
            />
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
                    <div className="flex min-w-[160px] flex-1 flex-col">
                      <span className="font-medium">{task.title}</span>
                      <span className="text-xs text-mutedText">
                        {task.domainName}
                      </span>
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
              href="/onboarding/name"
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
