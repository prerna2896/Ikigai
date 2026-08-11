'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  Settings,
  WeekGoal,
  WeekLogEntry,
  WeekNote,
  WeekPlan,
} from '@ikigai/core';
import { withDerivedPlannedHours } from '../plan/planUtils';
import { useRepository } from '../../../components/RepositoryProvider';
import { useCloudSyncVersion } from '../../../components/CloudSyncProvider';
import {
  decodeReflectionNote,
  formatReflectionTimestamp,
  reflectionCategoryLabel,
  type ParsedReflectionNote,
  type ReflectionCategoryId,
} from '../../../lib/reflectionNotes';

const CATEGORY_ORDER: ReflectionCategoryId[] = [
  'on_mind',
  'helped',
  'hindered',
  'lessons',
  'check_in',
];

const formatRange = (plan: WeekPlan, timeZone: string) => {
  const start = new Date(`${plan.weekStartISO}T00:00:00`);
  const end = new Date(`${plan.weekEndISO}T00:00:00`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | {
      kind: 'ready';
      plan: WeekPlan;
      logs: WeekLogEntry[];
      notes: WeekNote[];
      timeZone: string;
    };

export default function WeekRecapPage({
  params,
}: {
  params: { weekId: string };
}) {
  const weekId = decodeURIComponent(params.weekId);
  const { settingsRepo, weekPlanRepo, weekLogRepo, weekNoteRepo } =
    useRepository();
  const cloudVersion = useCloudSyncVersion();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsRepo || !weekPlanRepo || !weekLogRepo || !weekNoteRepo) {
      return;
    }
    let cancelled = false;
    Promise.all([
      settingsRepo.getSettings(),
      weekPlanRepo.listWeekPlans(),
      weekLogRepo.getWeekLogs(weekId),
      weekNoteRepo.listWeekNotes(weekId),
    ])
      .then(
        ([settings, plans, logs, notes]: [
          Settings,
          WeekPlan[],
          WeekLogEntry[],
          WeekNote[],
        ]) => {
          if (cancelled) return;
          const plan = plans.find((p) => p.id === weekId) ?? null;
          if (!plan) {
            setState({ kind: 'missing' });
            return;
          }
          const timeZone =
            settings.weekTimeZone ||
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            'UTC';
          setState({
            kind: 'ready',
            plan: withDerivedPlannedHours(plan),
            logs,
            notes,
            timeZone,
          });
        },
      )
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [weekId, settingsRepo, weekPlanRepo, weekLogRepo, weekNoteRepo, cloudVersion]);

  return (
    <main
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12"
      data-testid="week-recap-page"
    >
      <div>
        <Link
          href="/history"
          className="inline-flex items-center gap-1 text-xs text-mutedText transition-colors hover:text-text"
        >
          ← Back to history
        </Link>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          {error}
        </div>
      ) : null}

      {state.kind === 'loading' ? (
        <p className="text-sm text-mutedText">Loading…</p>
      ) : state.kind === 'missing' ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-text">
            We couldn’t find that week
          </h1>
          <p className="mt-2 text-sm text-mutedText">
            It may have been reset.{' '}
            <Link href="/history" className="underline-offset-2 hover:underline">
              Go back to history
            </Link>
            .
          </p>
        </section>
      ) : (
        <RecapContent
          plan={state.plan}
          logs={state.logs}
          notes={state.notes}
          timeZone={state.timeZone}
        />
      )}
    </main>
  );
}

type RecapContentProps = {
  plan: WeekPlan;
  logs: WeekLogEntry[];
  notes: WeekNote[];
  timeZone: string;
};

function RecapContent({ plan, logs, notes, timeZone }: RecapContentProps) {
  const goals: WeekGoal[] = plan.goals ?? [];
  const completedGoals = goals.filter((g) => Boolean(g.completedAt));

  const taskRows = useMemo(() => {
    const totals: Record<string, number> = {};
    logs.forEach((log) => {
      Object.entries(log.taskHours).forEach(([taskId, hours]) => {
        totals[taskId] = (totals[taskId] || 0) + hours;
      });
    });
    return plan.domains.flatMap((domain) =>
      domain.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        domainName: domain.name,
        planned: Math.round(task.plannedHours || 0),
        completed: Math.round(totals[task.id] || 0),
      })),
    );
  }, [plan, logs]);

  const totalPlanned = useMemo(
    () => taskRows.reduce((sum, t) => sum + t.planned, 0),
    [taskRows],
  );
  const totalCompleted = useMemo(
    () => taskRows.reduce((sum, t) => sum + t.completed, 0),
    [taskRows],
  );
  const followThrough =
    totalPlanned > 0
      ? Math.round((totalCompleted / totalPlanned) * 100)
      : 0;

  const decodedNotes: ParsedReflectionNote[] = useMemo(
    () =>
      [...notes]
        .sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
        )
        .map(decodeReflectionNote)
        .filter((n) => n.text.trim().length > 0 || Boolean(n.emoji)),
    [notes],
  );

  const groupedNotes = useMemo(() => {
    const buckets = new Map<ReflectionCategoryId, ParsedReflectionNote[]>();
    decodedNotes.forEach((note) => {
      if (!note.categoryId) return;
      const list = buckets.get(note.categoryId) ?? [];
      list.push(note);
      buckets.set(note.categoryId, list);
    });
    return CATEGORY_ORDER.flatMap((id) => {
      const entries = buckets.get(id);
      if (!entries || entries.length === 0) return [];
      return [{ id, entries }];
    });
  }, [decodedNotes]);

  return (
    <>
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Week recap
        </p>
        <h1 className="text-3xl font-semibold text-text">
          {formatRange(plan, timeZone)}
        </h1>
      </header>

      <section
        className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
        data-testid="recap-reflections"
      >
        <h2 className="text-sm font-semibold text-text">Reflections</h2>
        {groupedNotes.length === 0 ? (
          <p className="mt-3 text-sm text-mutedText">
            Nothing saved against this week.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {groupedNotes.map((group) => {
              const isCheckIn = group.id === 'check_in';
              return (
                <div key={group.id}>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-mutedText">
                    {isCheckIn
                      ? 'Check-ins'
                      : reflectionCategoryLabel(group.id)}
                  </p>
                  {isCheckIn ? (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {group.entries.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center gap-2 rounded-full border border-slate-200 bg-bg/40 px-3 py-1 text-xs text-mutedText"
                        >
                          {entry.emoji ? (
                            <span aria-hidden className="text-base leading-none">
                              {entry.emoji}
                            </span>
                          ) : null}
                          {entry.text ? (
                            <span className="text-text">{entry.text}</span>
                          ) : null}
                          <span className="text-[10px]">
                            {formatReflectionTimestamp(entry.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ol className="mt-2 space-y-2">
                      {group.entries.map((entry) => (
                        <li
                          key={entry.id}
                          className="rounded-xl border border-slate-100 bg-bg/40 px-3 py-2"
                        >
                          <p className="whitespace-pre-wrap text-sm text-text">
                            {entry.text}
                          </p>
                          <p className="mt-1 text-[10px] text-mutedText">
                            {formatReflectionTimestamp(entry.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
        data-testid="recap-summary"
      >
        <h2 className="text-sm font-semibold text-text">Performance</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Stat
            label="Goals met"
            value={`${completedGoals.length}/${goals.length || 0}`}
            sub={
              goals.length === 0
                ? 'No goals set'
                : completedGoals.length === goals.length
                  ? 'All checked off'
                  : `${goals.length - completedGoals.length} still open`
            }
          />
          <Stat
            label="Hours logged"
            value={`${totalCompleted}h`}
            sub={`of ${totalPlanned}h planned`}
          />
          <Stat
            label="Follow-through"
            value={totalPlanned > 0 ? `${followThrough}%` : '—'}
            sub={
              totalPlanned === 0
                ? 'Nothing planned'
                : followThrough >= 100
                  ? 'Met or exceeded'
                  : `${Math.max(0, totalPlanned - totalCompleted)}h short`
            }
          />
        </div>
      </section>

      {goals.length > 0 ? (
        <section
          className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
          data-testid="recap-goals"
        >
          <h2 className="text-sm font-semibold text-text">Goals</h2>
          <ul className="mt-3 space-y-2">
            {goals.map((goal) => {
              const done = Boolean(goal.completedAt);
              return (
                <li
                  key={goal.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      done
                        ? 'border-accent bg-accent text-white'
                        : 'border-slate-300 text-transparent'
                    }`}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 8l3.5 3.5L13 5" />
                    </svg>
                  </span>
                  <span
                    className={
                      done ? 'text-mutedText line-through' : 'text-text'
                    }
                  >
                    {goal.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {taskRows.length > 0 ? (
        <section
          className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
          data-testid="recap-tasks"
        >
          <h2 className="text-sm font-semibold text-text">Tasks</h2>
          <ul className="mt-3 space-y-2">
            {taskRows
              .sort((a, b) => b.planned - a.planned)
              .map((task) => {
                const isDone = task.planned > 0 && task.completed >= task.planned;
                const left = Math.max(0, task.planned - task.completed);
                return (
                  <li
                    key={task.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{task.title}</p>
                      <p className="text-[11px] text-mutedText">
                        {task.domainName}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end leading-tight">
                      <span
                        className={`text-sm font-semibold ${
                          isDone ? 'text-accent' : 'text-text'
                        }`}
                      >
                        {task.completed}h / {task.planned}h
                      </span>
                      <span className="text-[11px] text-mutedText">
                        {task.planned === 0
                          ? 'unplanned'
                          : isDone
                            ? 'all done'
                            : `${left}h left`}
                      </span>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-bg/40 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-mutedText">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-text">{value}</p>
      <p className="text-[11px] text-mutedText">{sub}</p>
    </div>
  );
}
