'use client';

// Diagnostic playground for the AI Insights prompt/model, matching the
// existing app/dev/sync-status page's "just a diagnostic tool" pattern
// with one difference: this one calls the real /api/insights/weekly
// route, which spends real OpenAI credits per click. Deliberately
// hidden in production (see the guard below) so it isn't something a
// random visitor stumbles into and triggers repeatedly — unlike
// sync-status, which is read-only against local IndexedDB and costs
// nothing to expose.
//
// Not a full eval harness: no automated pass/fail scoring. Each golden
// fixture (packages/insights/src/fixtures.ts) carries an `expectation`
// string that's shown alongside the real response for a human to
// eyeball — LLM output varies run to run, so exact-match assertions
// would be more noise than signal here.

import { useMemo, useState } from 'react';
import {
  IKIGAI_PRINCIPLE_IDS,
  IKIGAI_PRINCIPLE_LABEL,
  type IkigaiPrincipleId,
} from '@ikigai/core';
import {
  INSIGHT_FIXTURES,
  PERSONALITY_SEGMENTS,
  computeWeeklySignals,
  encouragementLineFor,
  principleLabelFor,
  selectSignalsForInsight,
  weeklyMetricsSummarySchema,
  type InsightFixture,
  type PersonalityRead,
  type PersonalitySegment,
  type PriorInsight,
  type ReflectionMood,
  type WeeklyMetricsSummary,
} from '@ikigai/insights';
import ModernMonk from '../../../components/ModernMonk';
import { useTheme, getMonkVariantForTheme } from '../../../hooks/useTheme';

type ReactionValue = 'heart' | 'thumbs_up' | 'thumbs_down';

type ReflectionTagResult = { reflectionId: string; domainName: string | null; mood: ReflectionMood };

// The result of testing the SEPARATE reflection-knowledge-base feature
// (see @ikigai/insights reflectionInsights.ts) against whatever
// reflections were typed into the "Reflections" section below — not to
// be confused with a run's own feedback note field further down (that
// one saves to .data/insights-playground-feedback.jsonl for prompt
// tuning and has nothing to do with reflections).
type RunEncouragement = {
  domainName: string | null;
  mood: ReflectionMood | null;
  line: string | null;
  tags: ReflectionTagResult[];
};

type RunResult = {
  id: string;
  fixtureLabel: string;
  timestamp: string;
  latencyMs: number;
  summary: WeeklyMetricsSummary;
  outcome:
    | { kind: 'silent' }
    | { kind: 'spoke'; insight: string; tone: 'celebrate' | 'attention' }
    | { kind: 'error'; message: string };
  reaction: ReactionValue | null;
  note: string;
  noteSaved: boolean;
  encouragement: RunEncouragement | null;
};

type DraftReflection = { id: string; text: string };

function majorityMood(moods: ReflectionMood[]): ReflectionMood {
  const counts = new Map<ReflectionMood, number>();
  moods.forEach((m) => counts.set(m, (counts.get(m) ?? 0) + 1));
  let best = moods[0];
  let bestCount = 0;
  counts.forEach((count, mood) => {
    if (count > bestCount) {
      best = mood;
      bestCount = count;
    }
  });
  return best;
}

// Mirrors lib/useReflectionKnowledgeBase.ts + app/insights/page.tsx's
// wiring exactly (same API route, same selectSignalsForInsight call to
// find which domain the insight sentence actually names, same
// encouragementLineFor template) so a playground run is a faithful
// preview of what the real /insights page would show — not a separate
// approximation that could drift from it.
async function tagReflectionsAndBuildEncouragement(
  reflections: DraftReflection[],
  summary: WeeklyMetricsSummary,
): Promise<RunEncouragement | null> {
  const nonEmpty = reflections.filter((r) => r.text.trim().length > 0);
  if (nonEmpty.length === 0) return null;

  const signalDomainNames = selectSignalsForInsight(summary.signals, summary.domains)
    .map((s) => s.domainName)
    .filter((n): n is string => Boolean(n));
  const targetDomainName = signalDomainNames[0] ?? null;

  try {
    const response = await fetch('/api/insights/reflections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reflections: nonEmpty.map((r) => ({ id: r.id, categoryId: null, text: r.text.slice(0, 500) })),
        domainNames: summary.domains.map((d) => d.name),
      }),
    });
    const data = (await response.json()) as { tags?: ReflectionTagResult[] };
    const tags = data.tags ?? [];
    if (!targetDomainName) return { domainName: null, mood: null, line: null, tags };

    const domainMoods = tags.filter((t) => t.domainName === targetDomainName).map((t) => t.mood);
    const mood = domainMoods.length > 0 ? majorityMood(domainMoods) : null;
    const domain = summary.domains.find((d) => d.name === targetDomainName);
    const line = domain && mood ? encouragementLineFor(principleLabelFor(summary.domains, domain), mood) : null;
    return { domainName: targetDomainName, mood, line, tags };
  } catch {
    return { domainName: targetDomainName, mood: null, line: null, tags: [] };
  }
}

const EMPTY_TEXTAREA_HINT =
  '// Pick a fixture, use the quick builder below, or paste/edit a WeeklyMetricsSummary JSON here.';

type DraftDomain = {
  id: string;
  name: string;
  principleId: IkigaiPrincipleId;
  plannedHours: string;
  loggedHours: string;
  hasPrior: boolean;
  priorPlannedHours: string;
  priorLoggedHours: string;
  // Simulates a domain's standout task (see WeeklyTaskSummary in
  // summary.ts) directly, rather than modeling a full task breakdown
  // per domain — the builder only tracks one row of hours per domain,
  // so this is the simplest way to test task-level naming without a
  // much larger UI. Empty name means no standout task, same as a real
  // domain with no clear single-task driver.
  topTaskName: string;
  topTaskLoggedHours: string;
  topTaskPriorLoggedHours: string;
};

type DraftGoal = { id: string; text: string; completed: boolean };

const newDraftDomain = (name: string, principleId: IkigaiPrincipleId): DraftDomain => ({
  id: crypto.randomUUID(),
  name,
  principleId,
  plannedHours: '10',
  loggedHours: '7',
  hasPrior: true,
  priorPlannedHours: '10',
  priorLoggedHours: '7',
  topTaskName: '',
  topTaskLoggedHours: '',
  topTaskPriorLoggedHours: '',
});

const num = (value: string) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

function buildSummaryFromDraft(input: {
  daysElapsedInWeek: string;
  domains: DraftDomain[];
  goals: DraftGoal[];
  personalityRead: PersonalityRead;
  // Simulates lib/useWeeklyInsight.ts's own priorInsight lookup (which
  // normally reads the prior week's local cache entry) — lets the
  // builder test the anti-repetition prompt rule without needing two
  // real consecutive weeks of app data.
  priorInsightText?: string;
  priorInsightSamePattern?: boolean;
}): WeeklyMetricsSummary {
  const domains = input.domains.map((d) => {
    const plannedHours = num(d.plannedHours);
    const loggedHours = num(d.loggedHours);
    const priorPlannedHours = d.hasPrior ? num(d.priorPlannedHours) : null;
    const priorLoggedHours = d.hasPrior ? num(d.priorLoggedHours) : null;
    return {
      name: d.name || 'Untitled',
      principleId: d.principleId,
      plannedHours,
      loggedHours,
      completionRatio: plannedHours > 0 ? loggedHours / plannedHours : 0,
      taskCount: 1,
      completedTaskCount: loggedHours >= plannedHours && plannedHours > 0 ? 1 : 0,
      priorPlannedHours,
      priorCompletionRatio:
        priorPlannedHours != null
          ? priorPlannedHours > 0
            ? (priorLoggedHours ?? 0) / priorPlannedHours
            : 0
          : null,
      topTask: d.topTaskName.trim()
        ? {
            name: d.topTaskName.trim(),
            loggedHours: num(d.topTaskLoggedHours),
            priorLoggedHours: d.topTaskPriorLoggedHours.trim() ? num(d.topTaskPriorLoggedHours) : null,
          }
        : null,
    };
  });

  const totalPlanned = domains.reduce((sum, d) => sum + d.plannedHours, 0);
  const totalLogged = domains.reduce((sum, d) => sum + d.loggedHours, 0);
  const anyPrior = input.domains.some((d) => d.hasPrior);
  const priorPlanned = domains.reduce((sum, d) => sum + (d.priorPlannedHours ?? 0), 0);
  const priorLogged = input.domains.reduce(
    (sum, d) => sum + (d.hasPrior ? num(d.priorLoggedHours) : 0),
    0,
  );

  const base = {
    weekId: 'quick-builder',
    daysElapsedInWeek: Math.min(7, Math.max(0, Math.round(num(input.daysElapsedInWeek)))),
    totals: {
      plannedHours: totalPlanned,
      loggedHours: totalLogged,
      completionRatio: totalPlanned > 0 ? totalLogged / totalPlanned : 0,
    },
    domains,
    priorWeek: anyPrior
      ? {
          plannedHours: priorPlanned,
          loggedHours: priorLogged,
          completionRatio: priorPlanned > 0 ? priorLogged / priorPlanned : 0,
        }
      : null,
    goals: input.goals
      .filter((g) => g.text.trim().length > 0)
      .map((g) => ({ text: g.text.trim(), completed: g.completed })),
    reflectionNoteCount: 0,
    contextNote: null,
    personalityRead: input.personalityRead,
  };

  const signals = computeWeeklySignals(base);
  const priorInsightText = input.priorInsightText?.trim();
  const priorInsight: PriorInsight | null = priorInsightText
    ? {
        text: priorInsightText,
        selectedSignals: input.priorInsightSamePattern
          ? selectSignalsForInsight(signals, domains).map((s) => ({
              reason: s.reason,
              domainName: s.domainName,
            }))
          : [],
      }
    : null;

  return { ...base, signals, priorInsight };
}

// Small paired horizontal bars — prior week vs this week's completion,
// one row per domain. Muted gray for "prior" (context, not the point),
// accent for "this week" (the thing being tested). A dev diagnostic,
// not a shipped product surface, so kept intentionally minimal: no
// hover layer, direct percentage labels instead.
function DomainCompletionChart({ summary }: { summary: WeeklyMetricsSummary }) {
  if (summary.domains.length === 0) return null;
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-4 text-xs text-mutedText">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-300" /> Prior week
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" /> This week
        </span>
      </div>
      {summary.domains.map((d) => {
        const firedSignal = summary.signals.find((s) => s.domainName === d.name);
        return (
          <div key={d.name}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-text">{d.name}</span>
              {firedSignal ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    firedSignal.kind === 'celebrate'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {firedSignal.reason.replaceAll('_', ' ')}
                </span>
              ) : null}
            </div>
            <div className="mt-1 space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-300"
                    style={{
                      width: `${Math.min(100, Math.round((d.priorCompletionRatio ?? 0) * 100))}%`,
                    }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-[11px] text-mutedText">
                  {d.priorCompletionRatio == null ? '—' : `${Math.round(d.priorCompletionRatio * 100)}%`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, Math.round(d.completionRatio * 100))}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-[11px] text-text">
                  {Math.round(d.completionRatio * 100)}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function InsightsPlaygroundPage() {
  const [jsonText, setJsonText] = useState(EMPTY_TEXTAREA_HINT);
  const [activeFixtureLabel, setActiveFixtureLabel] = useState<string | null>(
    null,
  );
  const [activeExpectation, setActiveExpectation] = useState<string | null>(
    null,
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const theme = useTheme();
  const monkVariant = getMonkVariantForTheme(theme);

  const [builderDaysElapsed, setBuilderDaysElapsed] = useState('5');
  // Health starts with an actual drop (0.8 → 0.3), not identical
  // planned/logged/prior values like the factory default — a brand-new
  // page load should already show a predicted signal and an enabled
  // "Generate" button, not a dead disabled state with no clear next
  // step. Work stays flat (the factory default) for contrast.
  const [builderDomains, setBuilderDomains] = useState<DraftDomain[]>([
    newDraftDomain('Work', 'contribution'),
    { ...newDraftDomain('Health', 'energy'), loggedHours: '3', priorLoggedHours: '8' },
  ]);
  const [builderGoals, setBuilderGoals] = useState<DraftGoal[]>([
    { id: crypto.randomUUID(), text: '', completed: false },
  ]);
  const [builderReflections, setBuilderReflections] = useState<DraftReflection[]>([]);
  const [builderPriorInsightText, setBuilderPriorInsightText] = useState('');
  const [builderPriorInsightSamePattern, setBuilderPriorInsightSamePattern] = useState(true);
  const [builderPersonality, setBuilderPersonality] = useState<PersonalityRead>(
    PERSONALITY_SEGMENTS[2].personalityRead,
  );

  const builderSummary = useMemo(
    () =>
      buildSummaryFromDraft({
        daysElapsedInWeek: builderDaysElapsed,
        domains: builderDomains,
        goals: builderGoals,
        personalityRead: builderPersonality,
        priorInsightText: builderPriorInsightText,
        priorInsightSamePattern: builderPriorInsightSamePattern,
      }),
    [
      builderDaysElapsed,
      builderDomains,
      builderGoals,
      builderPersonality,
      builderPriorInsightText,
      builderPriorInsightSamePattern,
    ],
  );

  if (process.env.NODE_ENV === 'production') {
    return (
      <main className="mx-auto max-w-xl px-6 py-12 text-sm text-mutedText">
        This diagnostic tool is not available in production — it spends real
        API credits per run.
      </main>
    );
  }

  const loadFixture = (fixture: InsightFixture) => {
    setJsonText(JSON.stringify(fixture.summary, null, 2));
    setActiveFixtureLabel(fixture.label);
    setActiveExpectation(fixture.expectation);
    setParseError(null);
  };

  // Overwrites just personalityRead in whatever's currently in the
  // textarea — lets you see how the SAME scenario reads across
  // segments without retyping the rest of the JSON by hand.
  const applySegment = (segment: PersonalitySegment) => {
    setBuilderPersonality(segment.personalityRead);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return;
    }
    parsed.personalityRead = segment.personalityRead;
    setJsonText(JSON.stringify(parsed, null, 2));
    setParseError(null);
  };

  const updateDomain = (id: string, patch: Partial<DraftDomain>) => {
    setBuilderDomains((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  };

  const applyBuilderToJson = () => {
    setJsonText(JSON.stringify(builderSummary, null, 2));
    setActiveFixtureLabel(null);
    setActiveExpectation(
      `Quick builder — ${builderSummary.signals.length} signal(s) predicted client-side (see chips above). Loaded into the JSON editor below; edit further there if needed.`,
    );
    setParseError(null);
  };

  const runSummary = async (
    summary: WeeklyMetricsSummary,
    label: string,
    reflections: DraftReflection[] = [],
  ) => {
    setIsRunning(true);
    const startedAt = performance.now();
    try {
      const response = await fetch('/api/insights/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      const body = (await response.json()) as
        | { shouldSpeak: false }
        | { shouldSpeak: true; insight: string; tone: 'celebrate' | 'attention' }
        | { error: string };
      const outcome: RunResult['outcome'] =
        !response.ok || 'error' in body
          ? {
              kind: 'error',
              message: 'error' in body ? body.error : `HTTP ${response.status}`,
            }
          : body.shouldSpeak
            ? { kind: 'spoke', insight: body.insight, tone: body.tone }
            : { kind: 'silent' };
      const encouragement =
        outcome.kind === 'spoke'
          ? await tagReflectionsAndBuildEncouragement(reflections, summary)
          : null;
      setRuns((prev) => [
        {
          id: crypto.randomUUID(),
          fixtureLabel: label,
          timestamp: new Date().toLocaleTimeString(),
          latencyMs,
          summary,
          outcome,
          reaction: null,
          note: '',
          noteSaved: false,
          encouragement,
        },
        ...prev,
      ]);
    } catch (err) {
      setRuns((prev) => [
        {
          id: crypto.randomUUID(),
          fixtureLabel: label,
          timestamp: new Date().toLocaleTimeString(),
          latencyMs: Math.round(performance.now() - startedAt),
          summary,
          outcome: { kind: 'error', message: err instanceof Error ? err.message : String(err) },
          reaction: null,
          note: '',
          noteSaved: false,
          encouragement: null,
        },
        ...prev,
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  // Fire-and-forget — feedback is a bonus for prompt tuning, never
  // something the diagnostic UI should block or error over.
  const postFeedback = (run: RunResult, patch: { reaction?: ReactionValue | null; note?: string }) => {
    const tone = run.outcome.kind === 'spoke' ? run.outcome.tone : null;
    const insightText = run.outcome.kind === 'spoke' ? run.outcome.insight : null;
    void fetch('/api/dev/insights-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fixtureLabel: run.fixtureLabel,
        tone,
        insightText,
        signals: run.summary.signals,
        reaction: patch.reaction !== undefined ? patch.reaction : run.reaction,
        note: patch.note !== undefined ? patch.note : run.note,
      }),
    }).catch(() => {
      // Non-critical — worst case the feedback isn't recorded this time.
    });
  };

  // postFeedback is a side effect, so it's deliberately kept OUT of the
  // setRuns updater callback below — React (Strict Mode, dev only)
  // invokes updater functions twice to surface exactly this kind of
  // impurity, which would otherwise double-POST every reaction/save.
  const setRunReaction = (runId: string, reaction: ReactionValue) => {
    const current = runs.find((run) => run.id === runId);
    if (!current) return;
    const nextReaction = current.reaction === reaction ? null : reaction;
    setRuns((prev) =>
      prev.map((run) => (run.id === runId ? { ...run, reaction: nextReaction } : run)),
    );
    postFeedback(current, { reaction: nextReaction });
  };

  const setRunNoteDraft = (runId: string, note: string) => {
    setRuns((prev) =>
      prev.map((run) => (run.id === runId ? { ...run, note, noteSaved: false } : run)),
    );
  };

  // Saving a note does three things: (1) always saves it as a
  // prompt-tuning note, same as before; (2) if it reads like a
  // reflection, ALSO upserts it into the Reflections section by a
  // stable per-run id — this is what makes it behave like a real saved
  // /reflect note instead of a one-off applied to just this run: it now
  // sticks around and gets included in every future "Generate" click,
  // same as real reflections would on the actual /insights page, until
  // removed from the Reflections list; (3) re-tags immediately so this
  // run's own preview updates without waiting for the next generate.
  const saveRunNote = (runId: string) => {
    const current = runs.find((run) => run.id === runId);
    if (!current) return;
    setRuns((prev) =>
      prev.map((run) => (run.id === runId ? { ...run, noteSaved: true } : run)),
    );
    postFeedback(current, { note: current.note });
    if (current.outcome.kind === 'spoke' && current.note.trim().length > 0) {
      const reflectionId = `note-${current.id}`;
      const noteText = current.note;
      setBuilderReflections((prev) =>
        prev.some((r) => r.id === reflectionId)
          ? prev.map((r) => (r.id === reflectionId ? { ...r, text: noteText } : r))
          : [...prev, { id: reflectionId, text: noteText }],
      );
      void tagReflectionsAndBuildEncouragement(
        [{ id: reflectionId, text: noteText }],
        current.summary,
      ).then((encouragement) => {
        setRuns((prev) => prev.map((run) => (run.id === runId ? { ...run, encouragement } : run)));
      });
    }
  };

  const runBuilderInsight = () =>
    void runSummary(builderSummary, '(quick builder)', builderReflections);

  const runInsight = async () => {
    setParseError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      setParseError(
        `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    const validated = weeklyMetricsSummarySchema.safeParse(parsed);
    if (!validated.success) {
      setParseError(
        `Doesn't match WeeklyMetricsSummary: ${validated.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
      return;
    }
    await runSummary(validated.data, activeFixtureLabel ?? '(custom JSON)', builderReflections);
  };

  return (
    <main
      className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12"
      data-testid="insights-playground-page"
    >
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Diagnostic
        </p>
        <h1 className="text-3xl font-semibold text-text">
          AI Insights playground
        </h1>
        <p className="text-sm text-mutedText">
          Calls the real /api/insights/weekly route — each run spends OpenAI
          credits. Not a scored test suite; compare the response against each
          fixture&apos;s expectation note yourself.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <aside className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-mutedText">
            Fixtures
          </p>
          {INSIGHT_FIXTURES.map((fixture) => (
            <button
              key={fixture.id}
              type="button"
              onClick={() => loadFixture(fixture)}
              className={`block w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                activeFixtureLabel === fixture.label
                  ? 'border-accent bg-accent/5 text-text'
                  : 'border-slate-200 text-mutedText hover:border-slate-300'
              }`}
            >
              {fixture.label}
            </button>
          ))}

          <p className="pt-4 text-xs font-medium uppercase tracking-[0.16em] text-mutedText">
            Personality segment
          </p>
          <p className="text-xs text-mutedText">
            Applies to the quick builder, and overwrites personalityRead in the
            JSON below if it&apos;s valid.
          </p>
          {PERSONALITY_SEGMENTS.map((segment) => (
            <button
              key={segment.id}
              type="button"
              title={segment.description}
              onClick={() => applySegment(segment)}
              className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm text-mutedText transition-colors hover:border-slate-300"
            >
              {segment.label}
            </button>
          ))}
        </aside>

        <div className="space-y-6">
          {/* Quick builder */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-mutedText">
                Quick builder
              </p>
              <label className="flex items-center gap-2 text-xs text-mutedText">
                Days elapsed
                <input
                  type="number"
                  min={0}
                  max={7}
                  value={builderDaysElapsed}
                  onChange={(e) => setBuilderDaysElapsed(e.target.value)}
                  className="w-14 rounded-lg border border-slate-200 px-2 py-1 text-text"
                />
              </label>
            </div>

            <div className="space-y-3">
              {builderDomains.map((d) => (
                <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={d.name}
                      onChange={(e) => updateDomain(d.id, { name: e.target.value })}
                      placeholder="Domain name"
                      className="min-w-[120px] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                    />
                    <select
                      value={d.principleId}
                      onChange={(e) => updateDomain(d.id, { principleId: e.target.value as IkigaiPrincipleId })}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                    >
                      {IKIGAI_PRINCIPLE_IDS.map((id) => (
                        <option key={id} value={id}>
                          {IKIGAI_PRINCIPLE_LABEL[id]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setBuilderDomains((prev) => prev.filter((x) => x.id !== d.id))}
                      className="ml-auto text-xs text-rose-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label className="text-xs text-mutedText">
                      Planned now
                      <input type="number" min={0} value={d.plannedHours} onChange={(e) => updateDomain(d.id, { plannedHours: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm text-text" />
                    </label>
                    <label className="text-xs text-mutedText">
                      Logged now
                      <input type="number" min={0} value={d.loggedHours} onChange={(e) => updateDomain(d.id, { loggedHours: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm text-text" />
                    </label>
                    <label className="text-xs text-mutedText">
                      Planned prior
                      <input type="number" min={0} disabled={!d.hasPrior} value={d.priorPlannedHours} onChange={(e) => updateDomain(d.id, { priorPlannedHours: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm text-text disabled:bg-slate-50 disabled:text-slate-300" />
                    </label>
                    <label className="text-xs text-mutedText">
                      Logged prior
                      <input type="number" min={0} disabled={!d.hasPrior} value={d.priorLoggedHours} onChange={(e) => updateDomain(d.id, { priorLoggedHours: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm text-text disabled:bg-slate-50 disabled:text-slate-300" />
                    </label>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs text-mutedText">
                    <input type="checkbox" checked={d.hasPrior} onChange={(e) => updateDomain(d.id, { hasPrior: e.target.checked })} />
                    Has prior-week data (uncheck to simulate a brand-new domain)
                  </label>
                  <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <p className="text-[11px] font-medium text-mutedText">
                      Standout task (optional — tests task-level naming)
                    </p>
                    <div className="mt-1.5 grid grid-cols-3 gap-2">
                      <input
                        value={d.topTaskName}
                        onChange={(e) => updateDomain(d.id, { topTaskName: e.target.value })}
                        placeholder="e.g. drawing"
                        className="col-span-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-text"
                      />
                      <input
                        type="number"
                        min={0}
                        value={d.topTaskLoggedHours}
                        onChange={(e) => updateDomain(d.id, { topTaskLoggedHours: e.target.value })}
                        placeholder="hours now"
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-text"
                      />
                      <input
                        type="number"
                        min={0}
                        value={d.topTaskPriorLoggedHours}
                        onChange={(e) => updateDomain(d.id, { topTaskPriorLoggedHours: e.target.value })}
                        placeholder="hours prior"
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-text"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setBuilderDomains((prev) => [...prev, newDraftDomain('New domain', 'growth')])}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-text"
              >
                + Add domain
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-mutedText">Goals</p>
              {builderGoals.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={g.completed}
                    onChange={(e) =>
                      setBuilderGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, completed: e.target.checked } : x)))
                    }
                  />
                  <input
                    value={g.text}
                    onChange={(e) =>
                      setBuilderGoals((prev) => prev.map((x) => (x.id === g.id ? { ...x, text: e.target.value } : x)))
                    }
                    placeholder="Goal text"
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                  />
                  <button type="button" onClick={() => setBuilderGoals((prev) => prev.filter((x) => x.id !== g.id))} className="text-xs text-rose-600 hover:underline">
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setBuilderGoals((prev) => [...prev, { id: crypto.randomUUID(), text: '', completed: false }])}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-text"
              >
                + Add goal
              </button>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-mutedText">
                Reflections (optional — tests the encouraging line)
              </p>
              <p className="text-[11px] text-mutedText">
                Simulates saved /reflect notes and runs them through the same
                domain+mood tagging the real /insights page uses — set these
                up before generating to test multiple reflections at once.
                For a single quick test, you can also just type into a
                completed run&apos;s note field below and hit Save; that
                previews the encouraging line too, alongside saving your
                prompt-tuning note.
              </p>
              {builderReflections.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <input
                    value={r.text}
                    onChange={(e) =>
                      setBuilderReflections((prev) =>
                        prev.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)),
                      )
                    }
                    placeholder="e.g. Really enjoyed drawing this week, felt like myself again"
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                  />
                  <button
                    type="button"
                    onClick={() => setBuilderReflections((prev) => prev.filter((x) => x.id !== r.id))}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setBuilderReflections((prev) => [...prev, { id: crypto.randomUUID(), text: '' }])
                }
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-text"
              >
                + Add reflection
              </button>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-mutedText">
                Last week&apos;s insight (optional — tests anti-repetition)
              </p>
              <p className="text-[11px] text-mutedText">
                Simulates lib/useWeeklyInsight.ts&apos;s own lookup of the
                prior week&apos;s cached insight. When set, the model is told
                not to repeat this phrasing; checking &quot;same pattern&quot;
                also tells it this week&apos;s signal is the same thing
                continuing, so it may (not must) acknowledge that.
              </p>
              <input
                value={builderPriorInsightText}
                onChange={(e) => setBuilderPriorInsightText(e.target.value)}
                placeholder="e.g. Alignment's been getting a lot of your focus lately, while Energy has quietly eased off."
                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
              />
              <label className="flex items-center gap-2 text-xs text-mutedText">
                <input
                  type="checkbox"
                  checked={builderPriorInsightSamePattern}
                  onChange={(e) => setBuilderPriorInsightSamePattern(e.target.checked)}
                  disabled={builderPriorInsightText.trim().length === 0}
                />
                Same pattern as this week (same signal + domain) — uncheck to
                simulate a genuinely different situation than last time
              </label>
            </div>

            <DomainCompletionChart summary={builderSummary} />

            <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-mutedText">
              {builderSummary.signals.length === 0 ? (
                <span>No signals would fire — this would stay silent, no API call in the real app.</span>
              ) : (
                <span>
                  {builderSummary.signals.length} signal(s) predicted:{' '}
                  {builderSummary.signals.map((s) => `${s.scope === 'domain' ? s.domainName : 'overall'} (${s.reason.replaceAll('_', ' ')})`).join(', ')}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runBuilderInsight}
                disabled={isRunning || builderSummary.signals.length === 0}
                className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                title={builderSummary.signals.length === 0 ? 'No signals — nothing to send, matches real app behavior' : undefined}
              >
                {isRunning ? 'Running…' : 'Generate insight from builder'}
              </button>
              <button
                type="button"
                onClick={applyBuilderToJson}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-text"
              >
                Copy into JSON editor
              </button>
            </div>
          </section>

          {/* Raw JSON editor */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-mutedText">
              Raw JSON (advanced)
            </p>
            <textarea
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value);
                setActiveFixtureLabel(null);
                setActiveExpectation(null);
              }}
              spellCheck={false}
              className="h-64 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs text-text"
            />
            {activeExpectation ? (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-mutedText">
                <span className="font-medium text-text">Expectation: </span>
                {activeExpectation}
              </p>
            ) : null}
            {parseError ? (
              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                {parseError}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void runInsight()}
            disabled={isRunning}
            className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isRunning ? 'Running…' : 'Generate insight from JSON'}
          </button>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-mutedText">
              Runs this session
            </p>
            {runs.length === 0 ? (
              <p className="text-sm text-mutedText">No runs yet.</p>
            ) : (
              runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-xl border border-slate-200 bg-surface p-3 text-sm"
                >
                  <div className="flex items-center justify-between text-xs text-mutedText">
                    <span>
                      {run.fixtureLabel} · {run.timestamp}
                    </span>
                    <span>{run.latencyMs}ms</span>
                  </div>
                  {run.outcome.kind === 'silent' ? (
                    <p className="mt-1 text-mutedText">
                      shouldSpeak: false (stayed silent)
                    </p>
                  ) : run.outcome.kind === 'spoke' ? (
                    <div className="mt-2">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0">
                          <ModernMonk
                            variant={monkVariant}
                            mood={run.outcome.tone === 'celebrate' ? 'smile' : 'calm'}
                            size={64}
                            message=""
                          />
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-mutedText">
                            {run.outcome.tone}
                          </p>
                          <p className="mt-1 text-text">{run.outcome.insight}</p>
                        </div>
                      </div>
                      {run.encouragement?.line ? (
                        <p
                          className="mt-2 text-text"
                          data-testid="playground-encouragement-preview"
                        >
                          {run.encouragement.line}
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-mutedText">
                            appended — as shown on /insights
                          </span>
                        </p>
                      ) : null}
                      {run.encouragement ? (
                        <div
                          className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs text-mutedText"
                          data-testid="playground-encouragement"
                        >
                          <p>
                            <span className="font-medium text-text">Reflection tags: </span>
                            {run.encouragement.tags.length === 0
                              ? 'none returned'
                              : run.encouragement.tags
                                  .map((t) => `${t.domainName ?? 'unmatched'}/${t.mood}`)
                                  .join(', ')}
                          </p>
                          <p className="mt-1">
                            <span className="font-medium text-text">
                              Encouraging line
                              {run.encouragement.domainName ? ` (${run.encouragement.domainName})` : ' (no domain named by the insight — nothing to ground it in)'}
                              :{' '}
                            </span>
                            {run.encouragement.line ?? '(none — no tagged reflection for that domain)'}
                          </p>
                        </div>
                      ) : null}
                      <div className="mt-3 flex items-center gap-1.5" data-testid="playground-run-reactions">
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
                            aria-pressed={run.reaction === option.value}
                            onClick={() => setRunReaction(run.id, option.value)}
                            className={`flex h-7 w-7 items-center justify-center rounded-full border text-sm transition-colors ${
                              run.reaction === option.value
                                ? 'scale-110 border-accent bg-accent/20 shadow-sm'
                                : 'border-slate-200 bg-white opacity-60 hover:opacity-100 hover:border-slate-300'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                        {run.reaction ? (
                          <span className="ml-1 text-[11px] text-mutedText" data-testid="playground-run-reaction-confirm">
                            Saved
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={run.note}
                          onChange={(event) => setRunNoteDraft(run.id, event.target.value)}
                          placeholder="What's off, or a reflection to test the encouraging line — e.g. 'drawing makes me happy'"
                          data-testid="playground-run-note-input"
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
                        />
                        <button
                          type="button"
                          onClick={() => saveRunNote(run.id)}
                          disabled={run.note.trim().length === 0}
                          data-testid="playground-run-note-save"
                          className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-text disabled:opacity-60"
                        >
                          {run.noteSaved ? 'Saved ✓' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-rose-700">
                      Error: {run.outcome.message}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
