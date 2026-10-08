import type { WeeklyDomainSummary, WeeklyMetricsSummary } from './summary';
import { computeWeeklySignals } from './signals';

// Golden-dataset scenarios for manually testing the insight prompt/model
// against the real route (see app/dev/insights-playground). Signals are
// computed here via the REAL computeWeeklySignals — the same function
// buildWeeklyMetricsSummary calls — rather than hand-typed, so a fixture
// can never drift out of sync with the actual gating logic.
//
// Because "should this fire" is now a deterministic threshold check
// (see signals.ts) rather than an LLM judgment call, most fixtures below
// have a hard expectedShouldSpeak — no LLM variance involved in whether
// the gate opens, only in how the chosen signal gets phrased.

export type InsightFixture = {
  id: string;
  label: string;
  expectation: string;
  // Hard-assertable ground truth for the eval script (scripts/eval-insights.mjs).
  // Left undefined only where phrasing/tone quality is what's actually
  // being tested, not the gate itself.
  expectedShouldSpeak?: boolean;
  summary: WeeklyMetricsSummary;
};

const basePersonality = {
  structureTolerance: 'balanced' as const,
  highEmotionalSensitivity: false,
  coachingStyle: 'balanced' as const,
};

type DraftSummary = Omit<WeeklyMetricsSummary, 'signals' | 'contextNote'> & {
  contextNote?: string | null;
};
const withSignals = (
  draft: DraftSummary,
  priorRatiosByDomain?: Record<string, number[]>,
): WeeklyMetricsSummary => ({
  ...draft,
  contextNote: draft.contextNote ?? null,
  signals: computeWeeklySignals(draft, priorRatiosByDomain),
});

const domain = (input: Omit<WeeklyDomainSummary, 'topTask'>): WeeklyDomainSummary => ({
  ...input,
  topTask: null,
});

export const INSIGHT_FIXTURES: InsightFixture[] = [
  {
    id: 'steady-week',
    label: 'Steady week, on track',
    expectation:
      'shouldSpeak: false — every domain is within a few points of its own prior week; no signal crosses threshold. This is now a deterministic guarantee, not an LLM judgment call.',
    expectedShouldSpeak: false,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 5,
      totals: { plannedHours: 40, loggedHours: 27, completionRatio: 0.675 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 25, loggedHours: 17, completionRatio: 0.68, taskCount: 4, completedTaskCount: 3, priorPlannedHours: 24, priorCompletionRatio: 0.67 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 8, loggedHours: 5, completionRatio: 0.625, taskCount: 3, completedTaskCount: 2, priorPlannedHours: 8, priorCompletionRatio: 0.65 }),
        domain({ name: 'Learning', principleId: 'growth', plannedHours: 7, loggedHours: 5, completionRatio: 0.71, taskCount: 2, completedTaskCount: 1, priorPlannedHours: 7, priorCompletionRatio: 0.7 }),
      ],
      priorWeek: { plannedHours: 40, loggedHours: 26, completionRatio: 0.65 },
      goals: [{ text: 'Build a consistent workout routine', completed: false }],
      reflectionNoteCount: 1,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'neglected-domain',
    label: 'One domain fully neglected, tied to a stated goal',
    expectation:
      'shouldSpeak: true — Health completion_drop (90→0) and Learning allocation_drop (6h→1h planned, though it hits 100% of its new tiny plan) both fire; Work stays quiet (flat vs. its own prior week, avoiding the old false-celebrate). Should ideally connect to the "regular exercise habit" goal.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 5,
      totals: { plannedHours: 29, loggedHours: 19, completionRatio: 0.655 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 20, loggedHours: 18, completionRatio: 0.9, taskCount: 4, completedTaskCount: 4, priorPlannedHours: 20, priorCompletionRatio: 0.85 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 8, loggedHours: 0, completionRatio: 0, taskCount: 3, completedTaskCount: 0, priorPlannedHours: 8, priorCompletionRatio: 0.9 }),
        domain({ name: 'Learning', principleId: 'growth', plannedHours: 1, loggedHours: 1, completionRatio: 1, taskCount: 1, completedTaskCount: 1, priorPlannedHours: 6, priorCompletionRatio: 0.83 }),
      ],
      priorWeek: { plannedHours: 34, loggedHours: 29, completionRatio: 0.85 },
      goals: [{ text: 'Get back into a regular exercise habit', completed: false }],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'improved-from-prior',
    label: 'Big improvement vs last week',
    expectation:
      'shouldSpeak: true — Work and Health both jumped 45-50 points in completion vs. their own prior week, well past the celebrate threshold.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 30, loggedHours: 27, completionRatio: 0.9 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 20, loggedHours: 19, completionRatio: 0.95, taskCount: 3, completedTaskCount: 3, priorPlannedHours: 20, priorCompletionRatio: 0.5 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 10, loggedHours: 8, completionRatio: 0.8, taskCount: 3, completedTaskCount: 2, priorPlannedHours: 10, priorCompletionRatio: 0.3 }),
      ],
      priorWeek: { plannedHours: 30, loggedHours: 12, completionRatio: 0.4 },
      goals: [
        { text: 'Ship the v2 feature at work', completed: true },
        { text: 'Get 3 workouts in', completed: true },
      ],
      reflectionNoteCount: 3,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'declined-from-prior',
    label: 'Noticeable decline vs last week',
    expectation:
      'shouldSpeak: true — every domain dropped 50+ points vs. its own prior week.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 35, loggedHours: 10, completionRatio: 0.286 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 22, loggedHours: 8, completionRatio: 0.364, taskCount: 4, completedTaskCount: 1, priorPlannedHours: 22, priorCompletionRatio: 0.9 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 8, loggedHours: 2, completionRatio: 0.25, taskCount: 2, completedTaskCount: 0, priorPlannedHours: 8, priorCompletionRatio: 0.85 }),
        domain({ name: 'Rest & Recharge', principleId: 'alignment', plannedHours: 5, loggedHours: 0, completionRatio: 0, taskCount: 1, completedTaskCount: 0, priorPlannedHours: 5, priorCompletionRatio: 0.7 }),
      ],
      priorWeek: { plannedHours: 35, loggedHours: 30, completionRatio: 0.857 },
      goals: [
        { text: 'Finish the client proposal', completed: false },
        { text: 'Take a full rest day', completed: false },
      ],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'sparse-data-robustness',
    label: 'Sparse data, first tracked week (robustness check)',
    expectation:
      'shouldSpeak: false — no prior week at all means computeWeeklySignals returns [] unconditionally, regardless of how little is logged. A first week is never enough to establish a baseline. In the real app this never reaches the model at all (client + server both gate on empty signals); this fixture confirms the gate itself, not the prompt.',
    expectedShouldSpeak: false,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 1,
      totals: { plannedHours: 40, loggedHours: 2, completionRatio: 0.05 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 25, loggedHours: 2, completionRatio: 0.08, taskCount: 4, completedTaskCount: 0, priorPlannedHours: null, priorCompletionRatio: null }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 8, loggedHours: 0, completionRatio: 0, taskCount: 2, completedTaskCount: 0, priorPlannedHours: null, priorCompletionRatio: null }),
      ],
      priorWeek: null,
      goals: [{ text: 'Start the week strong', completed: false }],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'goals-neglected',
    label: 'Tasks fine, goals untouched',
    expectation:
      'shouldSpeak: false — every domain is within a few points of its own prior week (genuinely steady hours); 0/2 goals completed does NOT, on its own, produce a signal — goals only provide context for an already-detected signal, they never trigger one by themselves. This directly resolves the earlier ambiguity.',
    expectedShouldSpeak: false,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 36, loggedHours: 32, completionRatio: 0.889 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 24, loggedHours: 22, completionRatio: 0.917, taskCount: 4, completedTaskCount: 4, priorPlannedHours: 24, priorCompletionRatio: 0.8 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 12, loggedHours: 10, completionRatio: 0.833, taskCount: 3, completedTaskCount: 3, priorPlannedHours: 12, priorCompletionRatio: 0.8 }),
      ],
      priorWeek: { plannedHours: 36, loggedHours: 30, completionRatio: 0.833 },
      goals: [
        { text: 'Read 2 books this month', completed: false },
        { text: 'Call a friend I haven’t talked to in a while', completed: false },
      ],
      reflectionNoteCount: 2,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'validation-forward-mild-dip',
    label: 'Real dip in one domain — validation_forward style',
    expectation:
      'shouldSpeak: true (Health completion_drop, 85→38). Tone should be gentle/validating, acknowledging before naming the fact. Compare directly against the direct_data_forward fixture below with identical numbers.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 5,
      totals: { plannedHours: 30, loggedHours: 18, completionRatio: 0.6 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 22, loggedHours: 15, completionRatio: 0.68, taskCount: 4, completedTaskCount: 2, priorPlannedHours: 22, priorCompletionRatio: 0.65 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 8, loggedHours: 3, completionRatio: 0.375, taskCount: 2, completedTaskCount: 0, priorPlannedHours: 8, priorCompletionRatio: 0.85 }),
      ],
      priorWeek: { plannedHours: 30, loggedHours: 22, completionRatio: 0.733 },
      goals: [{ text: 'Feel more energized by moving daily', completed: false }],
      reflectionNoteCount: 1,
      personalityRead: {
        structureTolerance: 'gentle_pacing',
        highEmotionalSensitivity: true,
        coachingStyle: 'validation_forward',
      },
    }),
  },
  {
    id: 'direct-data-forward-mild-dip',
    label: 'Real dip in one domain — direct_data_forward style',
    expectation:
      'Same numbers as the validation_forward fixture above (shouldSpeak: true, Health completion_drop). Should be blunt and numeric, no cushioning language.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 5,
      totals: { plannedHours: 30, loggedHours: 18, completionRatio: 0.6 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 22, loggedHours: 15, completionRatio: 0.68, taskCount: 4, completedTaskCount: 2, priorPlannedHours: 22, priorCompletionRatio: 0.65 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 8, loggedHours: 3, completionRatio: 0.375, taskCount: 2, completedTaskCount: 0, priorPlannedHours: 8, priorCompletionRatio: 0.85 }),
      ],
      priorWeek: { plannedHours: 30, loggedHours: 22, completionRatio: 0.733 },
      goals: [{ text: 'Feel more energized by moving daily', completed: false }],
      reflectionNoteCount: 1,
      personalityRead: {
        structureTolerance: 'structure_tolerant',
        highEmotionalSensitivity: false,
        coachingStyle: 'direct_data_forward',
      },
    }),
  },
  {
    id: 'pure-allocation-drop',
    label: 'Undercommitted domain that "completed" its shrunken plan',
    expectation:
      'shouldSpeak: true — allocation_drop only (Side Project planned hours dropped 10h→2h). Work and Health are both flat vs. their own prior week. The tricky part: Side Project hit 100% completion of its new tiny plan, so a completion-only view would see nothing wrong — this tests that allocation is checked independently of completion, per the explicit "undercommitting to a domain" case.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 32, loggedHours: 23, completionRatio: 0.719 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 20, loggedHours: 14, completionRatio: 0.7, taskCount: 4, completedTaskCount: 3, priorPlannedHours: 20, priorCompletionRatio: 0.68 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 10, loggedHours: 7, completionRatio: 0.7, taskCount: 3, completedTaskCount: 2, priorPlannedHours: 10, priorCompletionRatio: 0.72 }),
        domain({ name: 'Side Project', principleId: 'growth', plannedHours: 2, loggedHours: 2, completionRatio: 1, taskCount: 1, completedTaskCount: 1, priorPlannedHours: 10, priorCompletionRatio: 0.8 }),
      ],
      priorWeek: { plannedHours: 40, loggedHours: 28.8, completionRatio: 0.72 },
      goals: [{ text: 'Keep making progress on my side project', completed: false }],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'sustained-strong',
    label: 'Consistently strong domain, two weeks running',
    expectation:
      'shouldSpeak: true — Work has held ≥85% completion for two weeks in a row (sustained_strong celebrate). Health is flat, no signal. Tests the "some domain consistently doing well" case explicitly, distinct from a one-week improvement.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 32, loggedHours: 28, completionRatio: 0.875 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 22, loggedHours: 21, completionRatio: 0.955, taskCount: 4, completedTaskCount: 4, priorPlannedHours: 22, priorCompletionRatio: 0.9 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 10, loggedHours: 7, completionRatio: 0.7, taskCount: 3, completedTaskCount: 2, priorPlannedHours: 10, priorCompletionRatio: 0.72 }),
      ],
      priorWeek: { plannedHours: 32, loggedHours: 27, completionRatio: 0.844 },
      goals: [{ text: 'Keep shipping consistently at work', completed: true }],
      reflectionNoteCount: 1,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'mixed-celebrate-and-attention',
    label: 'One domain up, one domain down, same week',
    expectation:
      'shouldSpeak: true — Work jumped 35 points (celebrate) AND Health dropped 60 points (attention) in the same week. Per the priority rule, the model should speak about Health (the problem), especially since it connects to a stated goal — not celebrate Work instead. This is a real judgment test, not gate-deterministic on which one it picks.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 30, loggedHours: 21, completionRatio: 0.7 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 20, loggedHours: 19, completionRatio: 0.95, taskCount: 4, completedTaskCount: 4, priorPlannedHours: 20, priorCompletionRatio: 0.6 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 10, loggedHours: 2, completionRatio: 0.2, taskCount: 3, completedTaskCount: 0, priorPlannedHours: 10, priorCompletionRatio: 0.8 }),
      ],
      priorWeek: { plannedHours: 30, loggedHours: 20, completionRatio: 0.667 },
      goals: [{ text: 'Prioritize physical recovery this week', completed: false }],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'attention-no-goals-set',
    label: 'Real problem, but no goals set this week (grounding check)',
    expectation:
      'shouldSpeak: true — Work dropped 45 points (attention), goals is empty. Tests grounding: the model must NOT fabricate a goal connection when there isn\'t one — it should just name the pattern itself.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 30, loggedHours: 15, completionRatio: 0.5 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 20, loggedHours: 8, completionRatio: 0.4, taskCount: 4, completedTaskCount: 1, priorPlannedHours: 20, priorCompletionRatio: 0.85 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 10, loggedHours: 7, completionRatio: 0.7, taskCount: 3, completedTaskCount: 2, priorPlannedHours: 10, priorCompletionRatio: 0.7 }),
      ],
      priorWeek: { plannedHours: 30, loggedHours: 24, completionRatio: 0.8 },
      goals: [],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'overachievement-tradeoff',
    label: 'Overachieved on Work, Rest paid for it',
    expectation:
      'shouldSpeak: true — a single overachievement_tradeoff signal (Work at 150% of plan, Health/Rest dropped 76%→30%), NOT a separate completion_improved-for-Work plus completion_drop-for-Health. Tone should be "attention" (this signal only fires because Health genuinely dropped — never "celebrate"). Kenji should still lead the SENTENCE with the Work win, then name Health easing off, both in one sentence — not a plain celebration and not a scolding.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 30, loggedHours: 33, completionRatio: 1.1 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 20, loggedHours: 30, completionRatio: 1.5, taskCount: 4, completedTaskCount: 4, priorPlannedHours: 20, priorCompletionRatio: 0.85 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 10, loggedHours: 3, completionRatio: 0.3, taskCount: 3, completedTaskCount: 0, priorPlannedHours: 10, priorCompletionRatio: 0.76 }),
      ],
      priorWeek: { plannedHours: 30, loggedHours: 24.6, completionRatio: 0.82 },
      goals: [{ text: 'Protect at least one full rest day', completed: false }],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'sustained-underdelivery',
    label: 'Chronic — drawing has been low for a month',
    expectation:
      'shouldSpeak: true — a sustained_underdelivery signal for Alignment (drawing), which has stayed under 40% completion for 4 weeks running (this week included). Nothing CHANGED this week or last — Work and totals are flat — so the phrasing must not say "dropped" or "declined." Should read as gently naming a month-long pattern and wondering aloud whether it still belongs in the plan, not urging them to catch up on it.',
    expectedShouldSpeak: true,
    summary: withSignals(
      {
        weekId: '2026-08-24',
        daysElapsedInWeek: 6,
        totals: { plannedHours: 25, loggedHours: 15, completionRatio: 0.6 },
        domains: [
          domain({ name: 'Work', principleId: 'contribution', plannedHours: 20, loggedHours: 14, completionRatio: 0.7, taskCount: 4, completedTaskCount: 3, priorPlannedHours: 20, priorCompletionRatio: 0.7 }),
          domain({ name: 'drawing', principleId: 'alignment', plannedHours: 5, loggedHours: 1, completionRatio: 0.2, taskCount: 1, completedTaskCount: 0, priorPlannedHours: 5, priorCompletionRatio: 0.2 }),
        ],
        priorWeek: { plannedHours: 25, loggedHours: 15, completionRatio: 0.6 },
        goals: [],
        reflectionNoteCount: 0,
        personalityRead: basePersonality,
      },
      { drawing: [0.3, 0.2] },
    ),
  },
  {
    id: 'reallocation-multi-drop',
    label: 'Work overachieved, Health AND Family both paid for it',
    expectation:
      'shouldSpeak: true — ONE overachievement_tradeoff signal naming Work (Contribution) plus BOTH Health (Energy) and Family (Growth) as relatedDomainNames, not a separate completion_drop for each. Tone should be "attention," not "celebrate" — two real domains dropped for this to fire at all. Total logged hours barely move week over week (21h → 20h) so overall_decline_ambiguous must NOT fire — this is a pure reallocation, not a falloff. Kenji should lead with the win and name BOTH domains that eased off, in one sentence, without reciting the 150% or inventing a trailing clause about what they need.',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 30, loggedHours: 20, completionRatio: 0.667 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 10, loggedHours: 15, completionRatio: 1.5, taskCount: 2, completedTaskCount: 2, priorPlannedHours: 10, priorCompletionRatio: 0.7 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 10, loggedHours: 2, completionRatio: 0.2, taskCount: 2, completedTaskCount: 0, priorPlannedHours: 10, priorCompletionRatio: 0.7 }),
        domain({ name: 'Family', principleId: 'growth', plannedHours: 10, loggedHours: 3, completionRatio: 0.3, taskCount: 2, completedTaskCount: 0, priorPlannedHours: 10, priorCompletionRatio: 0.7 }),
      ],
      priorWeek: { plannedHours: 30, loggedHours: 21, completionRatio: 0.7 },
      goals: [],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
  {
    id: 'overall-decline-ambiguous',
    label: 'Overall logged hours dropped across the board',
    expectation:
      'shouldSpeak: true — overall_decline_ambiguous fires (35h → 24h, a 31% drop) and must be the ONLY signal selected (see selectSignalsForInsight), even though Health also independently dropped. Kenji must state the bare fact and NOT guess a cause ("you seem busy," "life got in the way," etc. are all wrong) and must NOT ask a question in the sentence itself (the occupied-prompt UI asks separately). No "it\'ll be there when you circle back" tail either — nothing named is "it."',
    expectedShouldSpeak: true,
    summary: withSignals({
      weekId: '2026-08-24',
      daysElapsedInWeek: 6,
      totals: { plannedHours: 40, loggedHours: 24, completionRatio: 0.6 },
      domains: [
        domain({ name: 'Work', principleId: 'contribution', plannedHours: 20, loggedHours: 14, completionRatio: 0.7, taskCount: 3, completedTaskCount: 2, priorPlannedHours: 20, priorCompletionRatio: 1.0 }),
        domain({ name: 'Health', principleId: 'energy', plannedHours: 20, loggedHours: 10, completionRatio: 0.5, taskCount: 2, completedTaskCount: 1, priorPlannedHours: 20, priorCompletionRatio: 0.75 }),
      ],
      priorWeek: { plannedHours: 40, loggedHours: 35, completionRatio: 0.875 },
      goals: [],
      reflectionNoteCount: 0,
      personalityRead: basePersonality,
    }),
  },
];
