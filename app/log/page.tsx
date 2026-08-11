'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '../../lib/errors';
import Link from 'next/link';
import type { Settings, WeekPlan } from '@ikigai/core';
import LogPanel from '../../components/LogPanel';
import { withDerivedPlannedHours } from '../week/plan/planUtils';
import { resolveCurrentWeek } from '../../lib/weekPosition';
import { useRepository } from '../../components/RepositoryProvider';
import { useCloudSyncVersion } from '../../components/CloudSyncProvider';

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

type WeekState =
  | { kind: 'loading' }
  | { kind: 'no-plan-current'; latest: WeekPlan | null }
  | { kind: 'plan'; plan: WeekPlan; isCurrent: boolean };

export default function LogPage() {
  const { settingsRepo, weekPlanRepo } = useRepository();
  const cloudVersion = useCloudSyncVersion();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<WeekState>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsRepo || !weekPlanRepo) return;
    let cancelled = false;
    Promise.all([settingsRepo.getSettings(), weekPlanRepo.listWeekPlans()])
      .then(([settingsRecord, plans]) => {
        if (cancelled) return;
        setSettings(settingsRecord);
        if (plans.length === 0) {
          setState({ kind: 'no-plan-current', latest: null });
          return;
        }
        const sorted = [...plans].sort((a, b) =>
          a.weekStartISO < b.weekStartISO ? 1 : -1,
        );
        const status = resolveCurrentWeek(sorted, settingsRecord);
        if (status.kind === 'planned') {
          setState({
            kind: 'plan',
            plan: withDerivedPlannedHours(status.plan),
            isCurrent: true,
          });
        } else {
          setState({
            kind: 'plan',
            plan: withDerivedPlannedHours(sorted[0]),
            isCurrent: false,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [settingsRepo, weekPlanRepo, cloudVersion]);

  const timeZone =
    settings?.weekTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  return (
    <main
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12"
      data-testid="log-page"
    >
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Log
        </p>
        <h1 className="text-3xl font-semibold text-text">Log time</h1>
        {state.kind === 'plan' ? (
          <p className="text-sm text-mutedText">
            {state.isCurrent
              ? 'A quick update keeps the picture current.'
              : 'You’re logging against your last saved plan.'}
            {' '}
            <span className="text-mutedText">
              · {formatRange(state.plan, timeZone)}
            </span>
          </p>
        ) : null}
      </header>

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
      ) : state.kind === 'no-plan-current' && !state.latest ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-text">No plan yet</h2>
          <p className="mt-2 text-sm text-mutedText">
            Set up a week before you can log against it.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              className="inline-flex items-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
              href="/week/plan"
            >
              Plan a week
            </Link>
          </div>
        </section>
      ) : state.kind === 'plan' && !state.isCurrent ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            This week isn’t planned yet. You can still log against your last
            plan, or{' '}
            <Link href="/week/plan" className="underline-offset-2 hover:underline">
              start a new plan
            </Link>
            .
          </div>
          <LogPanel
            weekPlan={state.plan}
            onPlanChange={(next) =>
              setState({ kind: 'plan', plan: next, isCurrent: false })
            }
          />
        </>
      ) : state.kind === 'plan' ? (
        <LogPanel
          weekPlan={state.plan}
          onPlanChange={(next) =>
            setState((prev) =>
              prev.kind === 'plan' ? { ...prev, plan: next } : prev,
            )
          }
        />
      ) : null}
    </main>
  );
}
