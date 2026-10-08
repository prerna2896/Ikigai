import type {
  ProfileRepository,
  SettingsRepository,
  WeekLogRepository,
  WeekNoteRepository,
  WeekPlanRepository,
} from '@ikigai/storage';
import {
  buildWeeklyMetricsSummary,
  derivePersonalityRead,
  hashWeeklySummary,
} from '@ikigai/insights';
import {
  resolveCurrentWeek,
  findPlanForWeekStart,
  findPriorPlans,
  priorWeekStartISO,
} from './weekPosition';

// This + prior week + this many = the window sustained_underdelivery
// needs (signals.ts' SUSTAINED_UNDERDELIVERY_MIN_WEEKS) to detect a
// chronic multi-week pattern, not just a fresh week-over-week drop.
const OLDER_WEEKS_FOR_CHRONIC_CHECK = 2;
import { withDerivedPlannedHours } from '../app/week/plan/planUtils';
import { readCache, writeCache, FRESHNESS_MS } from './useWeeklyInsight';
import { latestHinderedNoteText } from './reflectionNotes';

// Fire-and-forget warmup for AI Insights — call this right after an
// action that could change this week's signals (logging hours,
// completing a task, toggling a goal) so the result is very likely
// already cached by the time the user opens /insights, instead of only
// ever computing on visit. Applies the exact same gates
// useWeeklyInsight does (disabled / sparse / no-signal / already-fresh)
// — this never calls the model more than the Insights page itself
// would, it just moves WHEN the one real call happens earlier.
//
// Deliberately not a server-side batch job (see the AI Insights
// architecture notes) — this keeps working identically for signed-in
// and signed-out users, since it's just the client doing its own
// lookup earlier, not a cron job that only signed-in users' data could
// ever reach.
export async function prefetchWeeklyInsightForCurrentWeek(repos: {
  settingsRepo: SettingsRepository | null;
  weekPlanRepo: WeekPlanRepository | null;
  weekLogRepo: WeekLogRepository | null;
  weekNoteRepo: WeekNoteRepository | null;
  profileRepo: ProfileRepository | null;
}): Promise<void> {
  const { settingsRepo, weekPlanRepo, weekLogRepo, weekNoteRepo, profileRepo } =
    repos;
  if (!settingsRepo || !weekPlanRepo || !weekLogRepo || !profileRepo) return;

  try {
    // Cheapest possible early exit — don't touch anything else if the
    // feature is off.
    const settings = await settingsRepo.getSettings();
    if (!settings.aiInsightsEnabled) return;

    const plans = await weekPlanRepo.listWeekPlans();
    if (plans.length === 0) return;
    const sorted = [...plans].sort((a, b) =>
      a.weekStartISO < b.weekStartISO ? 1 : -1,
    );
    const status = resolveCurrentWeek(sorted, settings);
    if (status.kind !== 'planned') return;

    const weekPlan = withDerivedPlannedHours(status.plan);
    const priorPlan = findPlanForWeekStart(
      sorted,
      priorWeekStartISO(weekPlan.weekStartISO),
    );
    const priorWeekPlan = priorPlan ? withDerivedPlannedHours(priorPlan) : null;

    const olderPlans = priorWeekPlan
      ? findPriorPlans(sorted, priorWeekPlan.weekStartISO, OLDER_WEEKS_FOR_CHRONIC_CHECK).map(
          withDerivedPlannedHours,
        )
      : [];

    const [weekLogs, priorWeekLogs, profile, notes, olderLogs] = await Promise.all([
      weekLogRepo.getWeekLogs(weekPlan.id),
      priorWeekPlan ? weekLogRepo.getWeekLogs(priorWeekPlan.id) : Promise.resolve([]),
      profileRepo.getProfile(),
      weekNoteRepo ? weekNoteRepo.listWeekNotes(weekPlan.id) : Promise.resolve([]),
      Promise.all(olderPlans.map((plan) => weekLogRepo.getWeekLogs(plan.id))),
    ]);
    const olderWeeks = olderPlans.map((plan, i) => ({ weekPlan: plan, weekLogs: olderLogs[i] }));

    const personalityRead = derivePersonalityRead(profile?.reflections ?? []);
    const summary = buildWeeklyMetricsSummary({
      weekPlan,
      weekLogs,
      priorWeekPlan,
      priorWeekLogs,
      olderWeeks,
      reflectionNoteCount: notes.length,
      contextNote: latestHinderedNoteText(notes, weekPlan.id),
      personalityRead,
      now: new Date(),
    });

    if (summary.daysElapsedInWeek < 2 || summary.totals.plannedHours === 0) return;
    if (summary.signals.length === 0) return;

    const summaryHash = hashWeeklySummary(summary);
    const cached = readCache(summary.weekId);
    if (
      cached &&
      cached.summaryHash === summaryHash &&
      Date.now() - cached.generatedAt < FRESHNESS_MS
    ) {
      return; // already warm — nothing to do
    }

    const response = await fetch('/api/insights/weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as
      | { shouldSpeak: false }
      | { shouldSpeak: true; insight: string; tone: 'celebrate' | 'attention'; insightId: string };
    writeCache(summary.weekId, {
      summaryHash,
      shouldSpeak: data.shouldSpeak,
      insight: data.shouldSpeak ? data.insight : undefined,
      tone: data.shouldSpeak ? data.tone : undefined,
      insightId: data.shouldSpeak ? data.insightId : undefined,
      signalReasons: summary.signals.map((s) => s.reason),
      generatedAt: Date.now(),
    });
  } catch {
    // Best-effort warmup — any failure here just means /insights
    // computes it fresh (and possibly waits a moment) when actually
    // visited. Never worth surfacing to the user from a background call
    // they didn't know was happening.
  }
}
