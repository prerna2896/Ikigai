import type { IkigaiPrincipleId, WeekLogEntry, WeekPlan } from '@ikigai/core';
import type { PriorInsight, WeeklyDomainSummary, WeeklyMetricsSummary } from './summary';
import type { PersonalityRead } from './traits';
import type { ReflectionForAnalysis } from './reflectionInsights';

// ============================================================================
// Sample data covering every input dimension AI Insights considers, in one
// place — both a reusable fixture library for tests (packages/insights/src/
// *.test.ts, packages/companion/src/*.test.ts) and a literal enumeration of
// "everything the system reads," since the two tend to drift apart when kept
// separately. If a new input dimension is added anywhere in this package
// (or @ikigai/companion), it belongs here too.
//
// Dimensions covered, each with its own section below:
//   1. Domain shapes (WeeklyDomainSummary) — one per notable pattern a
//      single domain can be in, including task-level standout variants.
//   2. Totals & prior-week shapes — steady, first-tracked-week (no prior),
//      sparse (too little data yet).
//   3. Goals — none, one incomplete, one completed, a full set of three.
//   4. Context note — the one deliberate raw-text exception (opt-in
//      "what was going on" answer).
//   4b. Persona note — the companion feature's own persona_summary,
//      fed in as tone-only background (never a source of new claims).
//   5. Personality reads — all 3 coaching styles x emotional-sensitivity.
//   6. Prior insight (anti-repetition) — same-pattern vs different-
//      situation, for both a "plain" reason and a "structurally-full" one.
//   7. Full WeeklyMetricsSummary scenarios — one per SignalReason (7),
//      plus edge cases (silence, two independent problems, reallocation
//      with 1 vs 2 droppers, ambiguous decline vs reallocation-explained).
//   8. Reflections — one per ReflectionMood, plus unmatched-domain and
//      multi-domain batches, for the encouragement-line pipeline.
//   9. Raw WeekPlan/WeekLogEntry fixtures — the layer BELOW
//      WeeklyDomainSummary, for testing computeTopTask directly.
// ============================================================================

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── 1. Domain shapes ────────────────────────────────────────────────────

function domain(overrides: Partial<WeeklyDomainSummary> & { name: string; principleId: IkigaiPrincipleId }): WeeklyDomainSummary {
  return {
    plannedHours: 10,
    loggedHours: 7,
    completionRatio: 0.7,
    taskCount: 1,
    completedTaskCount: 0,
    priorPlannedHours: 10,
    priorCompletionRatio: 0.7,
    topTask: null,
    ...overrides,
  };
}

export const SAMPLE_DOMAINS = {
  // Nothing notable — no signal should fire off this domain alone.
  steady: domain({ name: 'Work', principleId: 'contribution' }),

  // Completion dropped 50pt week over week (>= 30pt COMPLETION_DROP_THRESHOLD).
  completionDrop: domain({
    name: 'Health', principleId: 'energy',
    plannedHours: 10, loggedHours: 3, completionRatio: 0.3,
    priorPlannedHours: 10, priorCompletionRatio: 0.8,
  }),

  // Completion improved 40pt and is now >= 0.7 (COMPLETION_IMPROVE_THRESHOLD).
  completionImproved: domain({
    name: 'Learning', principleId: 'growth',
    plannedHours: 10, loggedHours: 8, completionRatio: 0.8,
    priorPlannedHours: 10, priorCompletionRatio: 0.4,
  }),

  // >= 0.85 completion two weeks running (SUSTAINED_STRONG_THRESHOLD).
  sustainedStrong: domain({
    name: 'Family', principleId: 'alignment',
    plannedHours: 10, loggedHours: 9, completionRatio: 0.9,
    priorPlannedHours: 10, priorCompletionRatio: 0.9,
  }),

  // Planned hours themselves shrank 50% vs prior (>= 40% ALLOCATION_DROP_RATIO).
  allocationDrop: domain({
    name: 'Side Project', principleId: 'growth',
    plannedHours: 4, loggedHours: 3, completionRatio: 0.75,
    priorPlannedHours: 8, priorCompletionRatio: 0.7,
  }),

  // Completed >= 130% of plan (OVERACHIEVEMENT_RATIO) — the "win" side of a tradeoff.
  overachieving: domain({
    name: 'Work', principleId: 'contribution',
    plannedHours: 10, loggedHours: 15, completionRatio: 1.5,
    priorPlannedHours: 10, priorCompletionRatio: 0.7,
  }),

  // No prior-week data at all (a domain that's brand new this week).
  firstWeek: domain({
    name: 'New Hobby', principleId: 'growth',
    plannedHours: 5, loggedHours: 3, completionRatio: 0.6,
    priorPlannedHours: null, priorCompletionRatio: null,
  }),

  // Stayed under 40% completion — used with olderWeeks ratios for the
  // sustained_underdelivery streak check (see SAMPLE_OLDER_RATIOS below).
  chronicUnderdelivery: domain({
    name: 'Side Project', principleId: 'growth',
    plannedHours: 10, loggedHours: 2, completionRatio: 0.2,
    priorPlannedHours: 10, priorCompletionRatio: 0.25,
  }),

  // Two tasks, one clearly dominant (delta >= 50% of domain delta, >= 1hr) —
  // computeTopTask (buildWeeklySummary.ts) should surface this as topTask.
  // Not constructed via computeTopTask here (that needs raw WeekPlan/
  // WeekLogEntry input, see buildWeeklySummary.test.ts) — this is the
  // ALREADY-RESOLVED shape a domain has once that logic has run, for
  // testing signals.ts's `nameFor` consumption of it directly.
  withQualifyingStandoutTask: domain({
    name: 'Creative Hobbies', principleId: 'alignment',
    plannedHours: 10, loggedHours: 15, completionRatio: 1.5,
    priorPlannedHours: 10, priorCompletionRatio: 0.2,
    topTask: { name: 'watercolor sketches', loggedHours: 12, priorLoggedHours: 2 },
  }),

  // Same numeric shape as withQualifyingStandoutTask but topTask is null —
  // e.g. the domain has only 1 task, or no single task explains most of
  // the change (computeTopTask's own job; this fixture is the "it
  // correctly declined to name one" case for signals.ts consumers).
  overachievingNoStandoutTask: domain({
    name: 'Work', principleId: 'contribution',
    plannedHours: 10, loggedHours: 15, completionRatio: 1.5,
    priorPlannedHours: 10, priorCompletionRatio: 0.7,
    topTask: null,
  }),
} satisfies Record<string, WeeklyDomainSummary>;

// Older-than-prior-week completion ratios, most-recent-first, paired with
// SAMPLE_DOMAINS.chronicUnderdelivery — computeWeeklySignals needs 4
// consecutive weeks (this + prior + 2 older) all under 40% to fire
// sustained_underdelivery (SUSTAINED_UNDERDELIVERY_MIN_WEEKS).
export const SAMPLE_OLDER_RATIOS_FOUR_WEEK_STREAK: Record<string, number[]> = {
  'Side Project': [0.15, 0.3],
};
// Same domain, but the streak breaks 2 weeks back — should NOT fire.
export const SAMPLE_OLDER_RATIOS_BROKEN_STREAK: Record<string, number[]> = {
  'Side Project': [0.6, 0.1],
};

// ── 2. Totals & prior-week shapes ───────────────────────────────────────

export const SAMPLE_TOTALS = {
  steady: { plannedHours: 20, loggedHours: 15, completionRatio: 0.75 },
  // Dropped 33% vs prior (>= 30% OVERALL_DECLINE_RATIO), no domain rose to explain it.
  ambiguousDecline: { plannedHours: 20, loggedHours: 10, completionRatio: 0.5 },
};

export const SAMPLE_PRIOR_WEEK = {
  steady: { plannedHours: 20, loggedHours: 15, completionRatio: 0.75 },
  forAmbiguousDecline: { plannedHours: 20, loggedHours: 15, completionRatio: 0.75 },
  none: null,
};

// ── 3. Goals ─────────────────────────────────────────────────────────────

export const SAMPLE_GOALS = {
  none: [],
  oneIncomplete: [{ text: 'Protect at least one full rest day', completed: false }],
  oneCompleted: [{ text: 'Go for 3 runs this week', completed: true }],
  fullSet: [
    { text: 'Protect at least one full rest day', completed: false },
    { text: 'Finish the client proposal', completed: true },
    { text: 'Call mom', completed: false },
  ],
};

// ── 4. Context note ──────────────────────────────────────────────────────

export const SAMPLE_CONTEXT_NOTES = {
  none: null,
  traveling: 'Was traveling for work most of the week, barely had a laptop open.',
};

// ── 4b. Persona note (companion persona_summary, tone-only background) ──

export const SAMPLE_PERSONA_NOTES = {
  none: null,
  selfCritical:
    'Tends to be hard on themselves when they fall behind; responds well to plain, low-pressure phrasing rather than encouragement that risks sounding like praise.',
};

// ── 5. Personality reads ─────────────────────────────────────────────────

export const SAMPLE_PERSONALITIES: Record<string, PersonalityRead> = {
  validationForward: {
    structureTolerance: 'gentle_pacing',
    highEmotionalSensitivity: true,
    coachingStyle: 'validation_forward',
  },
  balanced: {
    structureTolerance: 'balanced',
    highEmotionalSensitivity: false,
    coachingStyle: 'balanced',
  },
  directDataForward: {
    structureTolerance: 'structure_tolerant',
    highEmotionalSensitivity: false,
    coachingStyle: 'direct_data_forward',
  },
};

// ── 6. Prior insight (anti-repetition) ──────────────────────────────────

export const SAMPLE_PRIOR_INSIGHTS: Record<string, PriorInsight | null> = {
  none: null,
  // Same reason+domain as a "plain" signal this week (e.g. completion_drop
  // on Health) — should be treated as a continuing pattern.
  samePatternPlain: {
    text: "Energy's had less of your time lately — it'll be there whenever you circle back to it.",
    selectedSignals: [{ reason: 'completion_drop', domainName: 'Health' }],
  },
  // Different reason/domain — should be treated as unrelated, no
  // continuation language, and (for plain reasons) still passed through
  // as "don't repeat this wording."
  differentSituation: {
    text: 'Growth has held strong for two weeks running.',
    selectedSignals: [{ reason: 'sustained_strong', domainName: 'Learning' }],
  },
  // Same reason+domain as a STRUCTURALLY-FULL signal (overachievement_tradeoff
  // on Work) — priorInsight is suppressed entirely for these regardless
  // (see prompt.ts STRUCTURALLY_FULL_REASONS), so this exists specifically
  // to test that suppression, not to exercise "same pattern" handling.
  samePatternStructurallyFull: {
    text: "Contribution's been getting the lion's share lately, while Energy has eased off.",
    selectedSignals: [{ reason: 'overachievement_tradeoff', domainName: 'Work' }],
  },
};

// ── 7. Full WeeklyMetricsSummary scenarios (pre-signals base shape) ────
// Each omits `signals` — pass through computeWeeklySignals(base, ...) to
// get the real thing, matching buildWeeklyMetricsSummary's own flow. This
// keeps these fixtures honest: they test the CONDITIONS that should
// produce a signal, not a hand-asserted signal shape that could drift
// from what the real code computes.

type BaseSummary = Omit<WeeklyMetricsSummary, 'signals'>;

function baseSummary(overrides: Partial<BaseSummary> & { domains: WeeklyDomainSummary[] }): BaseSummary {
  return {
    weekId: 'sample-week',
    daysElapsedInWeek: 5,
    totals: SAMPLE_TOTALS.steady,
    priorWeek: SAMPLE_PRIOR_WEEK.steady,
    goals: SAMPLE_GOALS.none,
    reflectionNoteCount: 0,
    contextNote: SAMPLE_CONTEXT_NOTES.none,
    personalityRead: SAMPLE_PERSONALITIES.balanced,
    priorInsight: SAMPLE_PRIOR_INSIGHTS.none,
    ...overrides,
  };
}

export const SAMPLE_SCENARIOS: Record<string, BaseSummary> = {
  // No prior week anywhere → computeWeeklySignals returns [] unconditionally.
  firstTrackedWeek: baseSummary({
    domains: [SAMPLE_DOMAINS.firstWeek],
    priorWeek: SAMPLE_PRIOR_WEEK.none,
  }),

  // Nothing crosses any threshold — the silence case.
  silence: baseSummary({ domains: [SAMPLE_DOMAINS.steady] }),

  // One per SignalReason:
  completionDrop: baseSummary({ domains: [SAMPLE_DOMAINS.steady, SAMPLE_DOMAINS.completionDrop] }),
  completionImproved: baseSummary({ domains: [SAMPLE_DOMAINS.steady, SAMPLE_DOMAINS.completionImproved] }),
  sustainedStrong: baseSummary({ domains: [SAMPLE_DOMAINS.steady, SAMPLE_DOMAINS.sustainedStrong] }),
  allocationDrop: baseSummary({ domains: [SAMPLE_DOMAINS.steady, SAMPLE_DOMAINS.allocationDrop] }),
  overachievementTradeoffOneDropper: baseSummary({
    domains: [SAMPLE_DOMAINS.overachieving, SAMPLE_DOMAINS.completionDrop],
  }),
  overachievementTradeoffTwoDroppers: baseSummary({
    domains: [
      SAMPLE_DOMAINS.overachieving,
      SAMPLE_DOMAINS.completionDrop,
      domain({
        name: 'Family', principleId: 'alignment',
        plannedHours: 10, loggedHours: 4, completionRatio: 0.4,
        priorPlannedHours: 10, priorCompletionRatio: 0.75,
      }),
    ],
  }),
  overachievementTradeoffWithStandoutTask: baseSummary({
    domains: [SAMPLE_DOMAINS.withQualifyingStandoutTask, SAMPLE_DOMAINS.completionDrop],
  }),
  sustainedUnderdelivery: baseSummary({ domains: [SAMPLE_DOMAINS.chronicUnderdelivery] }),
  overallDeclineAmbiguous: baseSummary({
    domains: [SAMPLE_DOMAINS.steady, domain({
      name: 'Health', principleId: 'energy',
      plannedHours: 10, loggedHours: 3, completionRatio: 0.3,
      priorPlannedHours: 10, priorCompletionRatio: 0.5, // drop, but under COMPLETION_DROP_THRESHOLD
    })],
    totals: SAMPLE_TOTALS.ambiguousDecline,
    priorWeek: SAMPLE_PRIOR_WEEK.forAmbiguousDecline,
  }),

  // Two genuinely independent domain problems (not a tradeoff pair) —
  // selectSignalsForInsight should combine both over a solo anything else.
  twoIndependentProblems: baseSummary({
    domains: [
      SAMPLE_DOMAINS.completionDrop,
      domain({
        name: 'Side Project', principleId: 'growth',
        plannedHours: 4, loggedHours: 3, completionRatio: 0.75,
        priorPlannedHours: 8, priorCompletionRatio: 0.7, // allocation_drop
      }),
    ],
  }),

  // Goals + context note + a non-default personality all present together —
  // exercises suppressGoalsForTradeoff, the context-note prompt branch, and
  // non-balanced tone rules simultaneously.
  richContext: baseSummary({
    domains: [SAMPLE_DOMAINS.overachieving, SAMPLE_DOMAINS.completionDrop],
    goals: SAMPLE_GOALS.fullSet,
    contextNote: SAMPLE_CONTEXT_NOTES.traveling,
    personalityRead: SAMPLE_PERSONALITIES.validationForward,
    priorInsight: SAMPLE_PRIOR_INSIGHTS.samePatternStructurallyFull,
  }),
};

// ── 8. Reflections ───────────────────────────────────────────────────────

export const SAMPLE_REFLECTIONS: Record<string, ReflectionForAnalysis> = {
  positive: {
    id: 'r-positive', categoryId: 'helped',
    text: 'Spent real focused time on my career project this week and it felt great to finally ship something at work.',
  },
  negative: {
    id: 'r-negative', categoryId: 'hindered',
    text: 'Barely got to the gym, felt drained and guilty about skipping workouts.',
  },
  mixed: {
    id: 'r-mixed', categoryId: 'on_mind',
    text: 'Drawing again felt amazing but I also feel bad about how little time I gave it before this week.',
  },
  neutral: {
    id: 'r-neutral', categoryId: 'lessons',
    text: 'Logged three sessions of guitar practice this week, roughly 30 minutes each.',
  },
  // Deliberately not about any one domain — should tag domainName: null.
  unmatchedGeneral: {
    id: 'r-unmatched', categoryId: 'check_in',
    text: "Feeling okay overall, nothing major to report this week.",
  },
};

export const SAMPLE_REFLECTION_BATCH: ReflectionForAnalysis[] = [
  SAMPLE_REFLECTIONS.positive,
  SAMPLE_REFLECTIONS.negative,
  SAMPLE_REFLECTIONS.unmatchedGeneral,
];

export const SAMPLE_DOMAIN_NAMES = ['Work', 'Health', 'Drawing', 'Family'];

// ── 9. Raw WeekPlan / WeekLogEntry — the layer BELOW WeeklyDomainSummary.
// buildWeeklyMetricsSummary (buildWeeklySummary.ts) aggregates these into
// the WeeklyDomainSummary shapes above; computeTopTask specifically reads
// per-TASK hours from here, which is otherwise invisible once aggregated.
// Covers: a domain with a clear standout task (one task dominates the
// week's change), a domain where the change is too spread out to single
// one out, and a domain with only 1 task (topTask never applies — no
// second task to compare against).

function weekLog(weekId: string, dateISO: string, taskHours: Record<string, number>): WeekLogEntry {
  return { id: `log-${dateISO}-${weekId}`, weekId, dateISO, taskHours, createdAt: dateISO, updatedAt: dateISO };
}

// Domain "Creative Hobbies" (alignment) with 2 tasks: "watercolor
// sketches" dominates the week's change (delta 10h, >=50% of the
// domain's own 10h delta, >=1hr) — computeTopTask should surface it.
export const SAMPLE_PLAN_WITH_STANDOUT_TASK: WeekPlan = {
  id: 'plan-standout', weekStartISO: '2026-09-14', weekEndISO: '2026-09-20',
  weekStartDay: 'monday', weekTimeZone: 'UTC', createdAtISO: '2026-09-14T00:00:00Z',
  isFrozen: false,
  domains: [{
    id: 'dom-hobbies', name: 'Creative Hobbies', colorKey: 'rose', principleId: 'alignment',
    plannedHours: 10,
    tasks: [
      { id: 'task-watercolor', title: 'watercolor sketches', plannedHours: 6 },
      { id: 'task-journal', title: 'evening journaling', plannedHours: 4 },
    ],
  }],
};
export const SAMPLE_LOGS_WITH_STANDOUT_TASK_THIS_WEEK: WeekLogEntry[] = [
  weekLog('plan-standout', '2026-09-15', { 'task-watercolor': 8, 'task-journal': 1 }),
  weekLog('plan-standout', '2026-09-17', { 'task-watercolor': 4 }),
];
export const SAMPLE_LOGS_WITH_STANDOUT_TASK_PRIOR_WEEK: WeekLogEntry[] = [
  weekLog('plan-standout', '2026-09-08', { 'task-watercolor': 2, 'task-journal': 1 }),
];

// A 3-task variant of the same domain, where the change splits roughly
// evenly three ways (~33% each) — no single task reaches the >=50%
// share MIN_STANDOUT_SHARE requires, so computeTopTask should return
// null. (A 2-task PERFECT 50/50 split, by contrast, legitimately DOES
// clear a >=50% threshold for one of the two tasks — that's a
// defensible "at least half" call, not the case this fixture tests.)
export const SAMPLE_PLAN_EVENLY_SPREAD: WeekPlan = {
  id: 'plan-standout', weekStartISO: '2026-09-14', weekEndISO: '2026-09-20',
  weekStartDay: 'monday', weekTimeZone: 'UTC', createdAtISO: '2026-09-14T00:00:00Z',
  isFrozen: false,
  domains: [{
    id: 'dom-hobbies', name: 'Creative Hobbies', colorKey: 'rose', principleId: 'alignment',
    plannedHours: 12,
    tasks: [
      { id: 'task-watercolor', title: 'watercolor sketches', plannedHours: 4 },
      { id: 'task-journal', title: 'evening journaling', plannedHours: 4 },
      { id: 'task-sketchbook', title: 'sketchbook doodles', plannedHours: 4 },
    ],
  }],
};
export const SAMPLE_LOGS_EVENLY_SPREAD_THIS_WEEK: WeekLogEntry[] = [
  weekLog('plan-standout', '2026-09-15', { 'task-watercolor': 4, 'task-journal': 4, 'task-sketchbook': 4 }),
];
export const SAMPLE_LOGS_EVENLY_SPREAD_PRIOR_WEEK: WeekLogEntry[] = [
  weekLog('plan-standout', '2026-09-08', { 'task-watercolor': 1, 'task-journal': 1, 'task-sketchbook': 1 }),
];

// A domain with only 1 task — topTask never applies regardless of how
// much that task's hours moved (nothing to single it out FROM).
export const SAMPLE_PLAN_SINGLE_TASK: WeekPlan = {
  id: 'plan-single', weekStartISO: '2026-09-14', weekEndISO: '2026-09-20',
  weekStartDay: 'monday', weekTimeZone: 'UTC', createdAtISO: '2026-09-14T00:00:00Z',
  isFrozen: false,
  domains: [{
    id: 'dom-work', name: 'Work', colorKey: 'blue', principleId: 'contribution',
    plannedHours: 10,
    tasks: [{ id: 'task-deepwork', title: 'deep work block', plannedHours: 10 }],
  }],
};
export const SAMPLE_LOGS_SINGLE_TASK_THIS_WEEK: WeekLogEntry[] = [
  weekLog('plan-single', '2026-09-15', { 'task-deepwork': 9 }),
];
export const SAMPLE_LOGS_SINGLE_TASK_PRIOR_WEEK: WeekLogEntry[] = [
  weekLog('plan-single', '2026-09-08', { 'task-deepwork': 3 }),
];

export { round1 };
