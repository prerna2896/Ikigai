'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '../../lib/errors';
import type { Profile, Settings, WeekLogEntry, WeekNote, WeekPlan } from '@ikigai/core';
import { useRepository } from '../../components/RepositoryProvider';
import { useCloudSyncVersion } from '../../components/CloudSyncProvider';
import {
  resolveCurrentWeek,
  findPlanForWeekStart,
  findPriorPlans,
  priorWeekStartISO,
} from '../../lib/weekPosition';
import { withDerivedPlannedHours } from '../week/plan/planUtils';
import { useWeeklyInsight } from '../../lib/useWeeklyInsight';
import { useReflectionKnowledgeBase } from '../../lib/useReflectionKnowledgeBase';
import { encodeReflectionNote, latestHinderedNoteText } from '../../lib/reflectionNotes';
import { createClient as createSupabaseClient } from '../../lib/supabase/client';
import ModernMonk from '../../components/ModernMonk';
import { useTheme, getMonkVariantForTheme } from '../../hooks/useTheme';
import {
  derivePersonalityRead,
  encouragementLineFor,
  principleLabelFor,
  NO_PLAN_NUDGE_COPY,
} from '@ikigai/insights';

// This + prior week + this many = the window sustained_underdelivery
// needs (signals.ts' SUSTAINED_UNDERDELIVERY_MIN_WEEKS) to detect a
// chronic multi-week pattern, not just a fresh week-over-week drop.
const OLDER_WEEKS_FOR_CHRONIC_CHECK = 2;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-plan'; profile: Profile | null }
  | {
      kind: 'ready';
      weekPlan: WeekPlan;
      priorWeekPlan: WeekPlan | null;
      olderPlans: WeekPlan[];
      settings: Settings;
      profile: Profile | null;
    };

export default function InsightsPage() {
  const { status, userId, settingsRepo, weekPlanRepo, weekLogRepo, weekNoteRepo, profileRepo } =
    useRepository();
  const cloudVersion = useCloudSyncVersion();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [weekLogs, setWeekLogs] = useState<WeekLogEntry[]>([]);
  const [priorWeekLogs, setPriorWeekLogs] = useState<WeekLogEntry[]>([]);
  const [olderWeeks, setOlderWeeks] = useState<
    { weekPlan: WeekPlan; weekLogs: WeekLogEntry[] }[]
  >([]);
  const [notes, setNotes] = useState<WeekNote[]>([]);
  const [personaNote, setPersonaNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [occupiedDraft, setOccupiedDraft] = useState('');
  const [occupiedSaving, setOccupiedSaving] = useState(false);
  const [showTrend, setShowTrend] = useState(false);

  useEffect(() => {
    if (!settingsRepo || !weekPlanRepo || !profileRepo) return;
    let cancelled = false;
    Promise.all([
      settingsRepo.getSettings(),
      weekPlanRepo.listWeekPlans(),
      profileRepo.getProfile(),
    ])
      .then(([settingsRecord, plans, profile]) => {
        if (cancelled) return;
        if (plans.length === 0) {
          setState({ kind: 'no-plan', profile });
          return;
        }
        const sorted = [...plans].sort((a, b) =>
          a.weekStartISO < b.weekStartISO ? 1 : -1,
        );
        const status = resolveCurrentWeek(sorted, settingsRecord);
        if (status.kind !== 'planned') {
          setState({ kind: 'no-plan', profile });
          return;
        }
        const weekPlan = withDerivedPlannedHours(status.plan);
        const priorWeekPlanRaw = findPlanForWeekStart(
          sorted,
          priorWeekStartISO(weekPlan.weekStartISO),
        );
        const priorWeekPlan = priorWeekPlanRaw
          ? withDerivedPlannedHours(priorWeekPlanRaw)
          : null;
        const olderPlans = priorWeekPlan
          ? findPriorPlans(
              sorted,
              priorWeekPlan.weekStartISO,
              OLDER_WEEKS_FOR_CHRONIC_CHECK,
            ).map(withDerivedPlannedHours)
          : [];
        setState({
          kind: 'ready',
          weekPlan,
          priorWeekPlan,
          olderPlans,
          settings: settingsRecord,
          profile,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [settingsRepo, weekPlanRepo, profileRepo, cloudVersion]);

  useEffect(() => {
    if (state.kind !== 'ready' || !weekLogRepo) return;
    let cancelled = false;
    weekLogRepo
      .getWeekLogs(state.weekPlan.id)
      .then((logs) => {
        if (!cancelled) setWeekLogs(logs);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    if (state.priorWeekPlan) {
      weekLogRepo
        .getWeekLogs(state.priorWeekPlan.id)
        .then((logs) => {
          if (!cancelled) setPriorWeekLogs(logs);
        })
        .catch(() => {
          if (!cancelled) setPriorWeekLogs([]);
        });
    } else {
      setPriorWeekLogs([]);
    }
    return () => {
      cancelled = true;
    };
  }, [state, weekLogRepo]);

  useEffect(() => {
    if (state.kind !== 'ready' || !weekLogRepo || state.olderPlans.length === 0) {
      setOlderWeeks([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      state.olderPlans.map((plan) =>
        weekLogRepo.getWeekLogs(plan.id).then((logs) => ({ weekPlan: plan, weekLogs: logs })),
      ),
    )
      .then((weeks) => {
        if (!cancelled) setOlderWeeks(weeks);
      })
      .catch(() => {
        if (!cancelled) setOlderWeeks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [state, weekLogRepo]);

  useEffect(() => {
    if (state.kind !== 'ready' || !weekNoteRepo) return;
    let cancelled = false;
    weekNoteRepo
      .listWeekNotes(state.weekPlan.id)
      .then((fetched) => {
        if (!cancelled) setNotes(fetched);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [state, weekNoteRepo]);

  // Companion persona — a signed-in-only, RLS-scoped read of the
  // chat feature's own running summary (see @ikigai/companion). Best-
  // effort background context for the weekly insight's tone; absent
  // entirely for signed-out/local-only users or anyone who hasn't used
  // the companion yet.
  useEffect(() => {
    if (status !== 'signed-in' || !userId) {
      setPersonaNote(null);
      return;
    }
    let cancelled = false;
    createSupabaseClient()
      .from('companion_context')
      .select('persona_summary')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }: { data: { persona_summary: string } | null }) => {
        if (!cancelled) setPersonaNote(data?.persona_summary || null);
      })
      .catch(() => {
        if (!cancelled) setPersonaNote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [status, userId]);

  const insight = useWeeklyInsight({
    weekPlan: state.kind === 'ready' ? state.weekPlan : null,
    priorWeekPlan: state.kind === 'ready' ? state.priorWeekPlan : null,
    weekLogs,
    priorWeekLogs,
    olderWeeks,
    profile: state.kind === 'ready' ? state.profile : null,
    settings: state.kind === 'ready' ? state.settings : null,
    reflectionNoteCount: notes.length,
    notes,
    personaNote,
  });
  const theme = useTheme();
  const monkVariant = getMonkVariantForTheme(theme);

  // Memoized so useReflectionKnowledgeBase's effect doesn't re-run every
  // render — a fresh array from state.weekPlan.domains.map(...) would
  // otherwise be a new reference every time even when the domains
  // themselves haven't changed.
  const domainNames = useMemo(
    () => (state.kind === 'ready' ? state.weekPlan.domains.map((d) => d.name) : []),
    [state],
  );
  const moodByDomain = useReflectionKnowledgeBase(notes, domainNames);

  // Grounds the encouraging line in the exact same domain the insight
  // sentence itself named (insight.signalDomainNames), not just any
  // domain with reflection data — otherwise the line could reference a
  // domain the insight never mentioned this week.
  const encouragementLine = useMemo(() => {
    if (state.kind !== 'ready' || insight.status !== 'ready') return null;
    const domainName = insight.signalDomainNames[0];
    if (!domainName) return null;
    const domain = state.weekPlan.domains.find((d) => d.name === domainName);
    if (!domain) return null;
    const mood = moodByDomain[domainName] ?? null;
    if (!mood) return null;
    const label = principleLabelFor(state.weekPlan.domains, domain);
    return encouragementLineFor(label, mood);
  }, [state, insight.status, insight.signalDomainNames, moodByDomain]);

  // Reuses the exact same weeks already fetched for the chronic
  // (sustained_underdelivery) signal check — no new data fetching, just
  // a different view onto it. Joined by domain NAME, not id, matching
  // the same stable-join-key convention used throughout @ikigai/insights
  // (an id can change if a plan was recreated; the name a person
  // recognizes doesn't).
  const domainTrend = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const weekFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    const weeksAsc = [
      ...[...olderWeeks].reverse(),
      ...(state.priorWeekPlan ? [{ weekPlan: state.priorWeekPlan, weekLogs: priorWeekLogs }] : []),
      { weekPlan: state.weekPlan, weekLogs },
    ].map((w) => ({
      label: weekFormatter.format(new Date(`${w.weekPlan.weekStartISO}T00:00:00`)),
      plan: w.weekPlan,
      logs: w.weekLogs,
    }));

    const domainNames = Array.from(
      new Set(weeksAsc.flatMap((w) => w.plan.domains.map((d) => d.name))),
    );

    return domainNames.map((name) => ({
      name,
      weeks: weeksAsc.map((w) => {
        const domain = w.plan.domains.find((d) => d.name === name);
        if (!domain) return { label: w.label, planned: null, logged: null };
        const taskIds = new Set(domain.tasks.map((t) => t.id));
        const logged = w.logs.reduce(
          (sum, log) =>
            sum +
            Object.entries(log.taskHours).reduce(
              (s, [taskId, hours]) => (taskIds.has(taskId) ? s + hours : s),
              0,
            ),
          0,
        );
        return { label: w.label, planned: domain.plannedHours || 0, logged };
      }),
    }));
  }, [state, olderWeeks, priorWeekLogs, weekLogs]);

  const showOccupiedPrompt =
    insight.status === 'ready' &&
    insight.tone === 'attention' &&
    (insight.signalReasons.includes('completion_drop') ||
      // The overall-decline signal is deliberately silent on cause (see
      // signals.ts checkOverallDecline) — this follow-up IS how that
      // question actually gets asked, not an optional extra for it.
      insight.signalReasons.includes('overall_decline_ambiguous')) &&
    state.kind === 'ready' &&
    latestHinderedNoteText(notes, state.weekPlan.id) === null;

  const handleSaveOccupied = async () => {
    const text = occupiedDraft.trim();
    if (!text || !weekNoteRepo || state.kind !== 'ready') return;
    setOccupiedSaving(true);
    try {
      const now = new Date().toISOString();
      const note: WeekNote = {
        id: crypto.randomUUID(),
        weekId: state.weekPlan.id,
        note: encodeReflectionNote('hindered', text),
        createdAt: now,
        updatedAt: now,
      };
      await weekNoteRepo.saveWeekNote(note);
      setNotes((prev) => [...prev, note]);
      setOccupiedDraft('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setOccupiedSaving(false);
    }
  };

  return (
    <main
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12"
      data-testid="insights-page"
    >
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
            Insights
          </p>
          {status === 'signed-in' ? (
            <Link
              href="/companion"
              data-testid="insights-companion-link"
              className="text-xs font-medium text-accent hover:underline"
            >
              Talk with Kenji →
            </Link>
          ) : null}
        </div>
        <h1 className="text-3xl font-semibold text-text">This week, quietly</h1>
        <p className="text-sm text-mutedText">
          A short, personal observation — only when there&apos;s something worth
          noticing.
        </p>
        {error ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {error}
          </div>
        ) : null}
      </header>

      {state.kind === 'loading' ? (
        <p className="text-sm text-mutedText">Loading…</p>
      ) : state.kind === 'no-plan' ? (
        <section
          className="flex flex-col items-center rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
          data-testid="insight-no-plan"
        >
          <ModernMonk
            variant={monkVariant}
            mood="smile"
            size={140}
            message={
              NO_PLAN_NUDGE_COPY[
                derivePersonalityRead(state.profile?.reflections ?? []).coachingStyle
              ]
            }
          />
          <Link
            href="/week/plan"
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Go to Plan
          </Link>
        </section>
      ) : insight.status === 'disabled' ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <p className="text-sm text-text">AI Insights is off.</p>
          <p className="mt-1 text-sm text-mutedText">
            Turn it on in Settings to occasionally see a short, personalized
            observation about your week here. Nothing is sent anywhere unless
            you enable it.
          </p>
          <Link
            href="/settings"
            className="mt-3 inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-text"
          >
            Go to Settings
          </Link>
        </section>
      ) : insight.status === 'sparse' ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <p className="text-sm text-mutedText">
            Not enough of the week has happened yet. Check back after you&apos;ve
            logged a few days.
          </p>
        </section>
      ) : insight.status === 'loading' ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <p className="text-sm text-mutedText">Reading your week…</p>
        </section>
      ) : insight.status === 'silent' ? (
        <section className="flex flex-col items-center rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <ModernMonk
            variant={monkVariant}
            mood="calm"
            size={140}
            message="Nothing pulling at my attention this week — steady as it goes."
          />
        </section>
      ) : insight.status === 'error' ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <p className="text-sm text-mutedText">
            Couldn&apos;t check in on your week just now. Try again a bit later.
          </p>
        </section>
      ) : (
        <section
          className="flex flex-col items-center rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
          data-testid="insight-card"
        >
          <ModernMonk
            variant={monkVariant}
            mood={insight.tone === 'celebrate' ? 'smile' : 'calm'}
            size={140}
            message={
              encouragementLine
                ? `${insight.insight ?? ''} ${encouragementLine}`
                : (insight.insight ?? '')
            }
          />
          <div className="mt-3 flex items-center gap-2" data-testid="insight-reactions">
            {(
              [
                { value: 'heart', label: '❤️', name: 'Love this' },
                { value: 'thumbs_up', label: '👍', name: 'Helpful' },
                { value: 'thumbs_down', label: '👎', name: 'Not helpful' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.name}
                aria-pressed={insight.reaction === option.value}
                onClick={() => insight.reactToInsight(option.value)}
                className={`flex h-9 w-9 items-center justify-center rounded-full border text-base transition-colors ${
                  insight.reaction === option.value
                    ? 'border-accent bg-accent/10'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {showOccupiedPrompt ? (
            <div
              className="mt-4 w-full rounded-xl border border-slate-200 bg-white p-3"
              data-testid="insight-occupied-prompt"
            >
              <p className="text-xs font-medium text-text">What&apos;s going on?</p>
              <p className="mt-0.5 text-xs text-mutedText">
                Optional — traveling, sick, a busy stretch at work. I&apos;ll
                keep it in mind next time.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={occupiedDraft}
                  onChange={(event) => setOccupiedDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleSaveOccupied();
                    }
                  }}
                  placeholder="e.g. traveling for work"
                  data-testid="insight-occupied-input"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveOccupied()}
                  disabled={occupiedDraft.trim().length === 0 || occupiedSaving}
                  data-testid="insight-occupied-save"
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-text disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {state.kind === 'ready' && domainTrend.length > 0 ? (
        <section
          className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm"
          data-testid="insight-trend-section"
        >
          <button
            type="button"
            onClick={() => setShowTrend((prev) => !prev)}
            aria-expanded={showTrend}
            data-testid="insight-trend-toggle"
            className="flex w-full items-center justify-between text-left text-sm font-medium text-text"
          >
            Task trend by domain
            <span className="text-mutedText">{showTrend ? '−' : '+'}</span>
          </button>
          {showTrend ? (
            <div className="mt-4 space-y-4">
              {domainTrend.map((domain) => (
                <div key={domain.name}>
                  <p className="text-xs font-medium text-text">{domain.name}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    {domain.weeks.map((week, i) => {
                      const isCurrent = i === domain.weeks.length - 1;
                      const ratio =
                        week.planned != null && week.planned > 0 && week.logged != null
                          ? week.logged / week.planned
                          : null;
                      return (
                        <div
                          key={`${domain.name}-${week.label}-${i}`}
                          className={`flex-1 rounded-lg border px-2 py-1.5 text-center ${
                            isCurrent
                              ? 'border-accent bg-accentSoft'
                              : 'border-slate-100 bg-slate-50'
                          }`}
                        >
                          <p className="text-[10px] uppercase tracking-wide text-mutedText">
                            {week.label}
                          </p>
                          <p
                            className={`text-xs font-medium ${isCurrent ? 'text-text' : 'text-mutedText'}`}
                          >
                            {ratio == null ? '—' : `${Math.round(ratio * 100)}%`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
