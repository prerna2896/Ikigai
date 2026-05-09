'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { Profile, Settings, WeekPlan } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import LogPanel from '../components/LogPanel';
import {
  daysSinceISO,
  resolveCurrentWeek,
  type CurrentWeekStatus,
} from '../lib/weekPosition';
import { withDerivedPlannedHours } from './week/plan/planUtils';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-onboarding' }
  | {
      kind: 'ready';
      profile: Profile | null;
      settings: Settings;
      weekStatus: CurrentWeekStatus;
      latestPlan: WeekPlan | null;
    };

const greetingFor = (date: Date) => {
  const hour = date.getHours();
  if (hour < 5) return 'Hello';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const formatToday = (date: Date) =>
  date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

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

const introCopy = (
  greeting: string,
  name: string,
  daysSinceLastActivity: number | null,
) => {
  if (daysSinceLastActivity === null) {
    return `${greeting}, ${name}. Take a minute to log how today’s going.`;
  }
  if (daysSinceLastActivity === 0) {
    return `${greeting}, ${name}. Picking up where you left off.`;
  }
  if (daysSinceLastActivity === 1) {
    return `${greeting}, ${name}. Welcome back — it’s been a day.`;
  }
  if (daysSinceLastActivity < 7) {
    return `${greeting}, ${name}. It’s been ${daysSinceLastActivity} days — a soft restart.`;
  }
  return `${greeting}, ${name}. It’s been a little while. Glad you’re here.`;
};

export default function HomePage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    setNow(new Date());
    let cancelled = false;
    try {
      const repo = getLocalRepository();
      Promise.all([
        repo.getProfile(),
        repo.getSettings(),
        repo.listWeekPlans(),
      ])
        .then(([profileRecord, settingsRecord, plans]) => {
          if (cancelled) return;
          const hasOnboarded = Boolean(profileRecord?.name);
          if (!hasOnboarded && plans.length === 0) {
            setState({ kind: 'no-onboarding' });
            return;
          }
          const sorted = [...plans].sort((a, b) =>
            a.weekStartISO < b.weekStartISO ? 1 : -1,
          );
          const status = resolveCurrentWeek(sorted, settingsRecord);
          const latest = sorted[0]
            ? withDerivedPlannedHours(sorted[0])
            : null;
          const normalizedStatus: CurrentWeekStatus =
            status.kind === 'planned'
              ? { ...status, plan: withDerivedPlannedHours(status.plan) }
              : status;
          setState({
            kind: 'ready',
            profile: profileRecord,
            settings: settingsRecord,
            weekStatus: normalizedStatus,
            latestPlan: latest,
          });
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    } catch (err) {
      setError(String(err));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePlanChange = (next: WeekPlan) => {
    setState((prev) => {
      if (prev.kind !== 'ready') return prev;
      if (prev.weekStatus.kind !== 'planned') return prev;
      return {
        ...prev,
        weekStatus: { ...prev.weekStatus, plan: next },
        latestPlan: next,
      };
    });
  };

  const handleLogSaved = () => {
    if (state.kind === 'ready' && state.profile) {
      setState({
        ...state,
        profile: {
          ...state.profile,
          lastActivityAt: new Date().toISOString(),
        },
      });
    }
  };

  const greeting = greetingFor(now);
  const todayLabel = formatToday(now);

  const greetingName = useMemo(() => {
    if (state.kind !== 'ready') return 'friend';
    return state.profile?.name?.split(' ')[0]?.trim() || 'friend';
  }, [state]);

  const daysSince = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return daysSinceISO(state.profile?.lastActivityAt ?? null, now);
  }, [state, now]);

  return (
    <main
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12"
      data-testid="home-page"
    >
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
      ) : state.kind === 'no-onboarding' ? (
        <NoOnboarding />
      ) : (
        <>
          <header className="space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Today · {todayLabel}
            </p>
            <h1 className="text-3xl font-semibold text-text">
              {introCopy(greeting, greetingName, daysSince)}
            </h1>
            {state.weekStatus.kind === 'planned' ? (
              <p className="text-sm text-mutedText">
                This week is planned ·{' '}
                {formatRange(state.weekStatus.plan, state.settings.weekTimeZone)}
              </p>
            ) : (
              <p className="text-sm text-mutedText">
                You haven’t planned this week yet.
              </p>
            )}
          </header>

          {state.weekStatus.kind === 'planned' ? (
            <PlannedWeekHome
              plan={state.weekStatus.plan}
              timeZone={state.settings.weekTimeZone}
              onPlanChange={handlePlanChange}
              onLogSaved={handleLogSaved}
            />
          ) : (
            <UnplannedWeekHome latestPlan={state.latestPlan} />
          )}
        </>
      )}
    </main>
  );
}

function NoOnboarding() {
  return (
    <section
      data-testid="welcome-screen"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center"
    >
      <Image
        src="/brand/mark-light.png"
        alt=""
        aria-hidden
        width={128}
        height={128}
        priority
        className="brand-mark-light h-32 w-32"
      />
      <Image
        src="/brand/mark-dark.png"
        alt=""
        aria-hidden
        width={128}
        height={128}
        priority
        className="brand-mark-dark h-32 w-32"
      />
      <h1 className="font-serif text-5xl font-semibold tracking-tight text-text">
        Ikigai
      </h1>
      <p className="max-w-xl text-base text-mutedText">
        A quiet space to notice how you spend your time, and whether it aligns
        with what matters to you.
      </p>
      <Link
        href="/onboarding/context"
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-medium text-white shadow-sm transition-opacity hover:opacity-90"
        data-testid="home-cta-get-started"
      >
        Begin <span aria-hidden>→</span>
      </Link>
      <p className="pt-4 text-xs text-mutedText">
        Not a productivity tool. A self-alignment mirror.
      </p>
    </section>
  );
}

type PlannedHomeProps = {
  plan: WeekPlan;
  timeZone: string;
  onPlanChange: (next: WeekPlan) => void;
  onLogSaved: () => void;
};

function PlannedWeekHome({
  plan,
  onPlanChange,
  onLogSaved,
}: PlannedHomeProps) {
  return (
    <>
      <section
        className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
        data-testid="latest-week"
      >
        <h2 className="text-lg font-semibold text-text">
          Log time since your last check-in
        </h2>
        <p className="mt-1 text-sm text-mutedText">
          A quick update keeps the picture current. Or open the full{' '}
          <Link href="/log" className="underline-offset-2 hover:underline">
            log page
          </Link>{' '}
          for more space.
        </p>
      </section>

      <LogPanel
        weekPlan={plan}
        onPlanChange={onPlanChange}
        onLogSaved={onLogSaved}
      />
    </>
  );
}

function UnplannedWeekHome({ latestPlan }: { latestPlan: WeekPlan | null }) {
  return (
    <>
      <section
        className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
        data-testid={latestPlan ? 'latest-week' : 'home-plan-cta'}
      >
        <h2 className="text-lg font-semibold text-text">Plan this week</h2>
        <p className="mt-2 text-sm text-mutedText">
          {latestPlan
            ? 'Your last plan is from a previous week. Set up a fresh one to start logging.'
            : 'A short setup gets you ready to log.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/week/plan"
            className="inline-flex items-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
            data-testid="home-cta-plan"
          >
            Plan this week
          </Link>
          {latestPlan ? (
            <Link
              href="/log"
              className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-text"
              data-testid="home-cta-log-old"
            >
              Log against last plan
            </Link>
          ) : null}
        </div>
      </section>
    </>
  );
}
