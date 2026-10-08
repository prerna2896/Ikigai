import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightSystemPrompt, buildInsightUserPrompt } from './prompt';
import { computeWeeklySignals } from './signals';
import { COACHING_STYLE_RULES } from './coachingStyles';
import {
  SAMPLE_SCENARIOS,
  SAMPLE_PERSONALITIES,
  SAMPLE_PRIOR_INSIGHTS,
  SAMPLE_GOALS,
  SAMPLE_CONTEXT_NOTES,
  SAMPLE_PERSONA_NOTES,
  SAMPLE_OLDER_RATIOS_FOUR_WEEK_STREAK,
} from './sampleData';
import type { WeeklyMetricsSummary } from './summary';

function withSignals(
  base: Omit<WeeklyMetricsSummary, 'signals'>,
  priorRatiosByDomain?: Record<string, number[]>,
): WeeklyMetricsSummary {
  return { ...base, signals: computeWeeklySignals(base, priorRatiosByDomain) };
}

describe('buildInsightSystemPrompt', () => {
  for (const [name, personality] of Object.entries(SAMPLE_PERSONALITIES)) {
    test(`${name}: includes that coaching style's tone instructions`, () => {
      const prompt = buildInsightSystemPrompt(personality);
      const rules = COACHING_STYLE_RULES[personality.coachingStyle];
      assert.ok(prompt.includes(rules.toneInstructions));
    });
  }

  test('never leaks internal mechanism words the model shouldn\'t echo back to the user', () => {
    // The prompt itself is allowed to use these words to INSTRUCT the
    // model not to mention them — this just guards the instruction
    // exists, not that the string is literally absent.
    const prompt = buildInsightSystemPrompt(SAMPLE_PERSONALITIES.balanced);
    assert.match(prompt, /never mention "signals,"/i);
  });

  test('rule 5 also forbids mentioning personas/past conversations', () => {
    const prompt = buildInsightSystemPrompt(SAMPLE_PERSONALITIES.balanced);
    assert.match(prompt, /personas,\s*"?past conversations/i);
  });

  test('persona-note rule frames it as tone-only, never a new claim', () => {
    const prompt = buildInsightSystemPrompt(SAMPLE_PERSONALITIES.balanced);
    assert.match(prompt, /tone and word-choice guidance only/i);
  });
});

describe('buildInsightUserPrompt — goals suppression for overachievement_tradeoff', () => {
  test('goals are suppressed even when present, when the selected signal is overachievement_tradeoff', () => {
    const summary = withSignals({
      ...SAMPLE_SCENARIOS.overachievementTradeoffOneDropper,
      goals: SAMPLE_GOALS.fullSet,
    });
    const prompt = buildInsightUserPrompt(summary);
    assert.match(prompt, /\(no goals set this week\)/);
    for (const g of SAMPLE_GOALS.fullSet) {
      assert.doesNotMatch(prompt, new RegExp(g.text));
    }
  });

  test('goals ARE shown for a non-tradeoff signal when present', () => {
    const summary = withSignals({
      ...SAMPLE_SCENARIOS.completionDrop,
      goals: SAMPLE_GOALS.oneIncomplete,
    });
    const prompt = buildInsightUserPrompt(summary);
    assert.match(prompt, new RegExp(SAMPLE_GOALS.oneIncomplete[0].text));
  });

  test('no goals set → explicit "(no goals set this week)" regardless of signal type', () => {
    const summary = withSignals({ ...SAMPLE_SCENARIOS.completionDrop, goals: SAMPLE_GOALS.none });
    const prompt = buildInsightUserPrompt(summary);
    assert.match(prompt, /\(no goals set this week\)/);
  });
});

describe('buildInsightUserPrompt — context note', () => {
  test('included when present', () => {
    const summary = withSignals({ ...SAMPLE_SCENARIOS.completionDrop, contextNote: SAMPLE_CONTEXT_NOTES.traveling });
    const prompt = buildInsightUserPrompt(summary);
    assert.match(prompt, /Context this person shared/);
    assert.match(prompt, new RegExp(SAMPLE_CONTEXT_NOTES.traveling));
  });

  test('section absent entirely when null', () => {
    const summary = withSignals({ ...SAMPLE_SCENARIOS.completionDrop, contextNote: null });
    const prompt = buildInsightUserPrompt(summary);
    assert.doesNotMatch(prompt, /Context this person shared/);
  });
});

describe('buildInsightUserPrompt — persona note', () => {
  test('included when present', () => {
    const summary = withSignals({
      ...SAMPLE_SCENARIOS.completionDrop,
      personaNote: SAMPLE_PERSONA_NOTES.selfCritical,
    });
    const prompt = buildInsightUserPrompt(summary);
    assert.match(prompt, /Who this person tends to be/);
    assert.match(prompt, new RegExp(SAMPLE_PERSONA_NOTES.selfCritical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('section absent entirely when null/omitted', () => {
    const summary = withSignals({ ...SAMPLE_SCENARIOS.completionDrop, personaNote: null });
    const prompt = buildInsightUserPrompt(summary);
    assert.doesNotMatch(prompt, /Who this person tends to be/);
  });
});

describe('buildInsightUserPrompt — priorInsight ("last time") section', () => {
  test('shown for a "plain" reason (completion_drop), with SAME-pattern language on a matching prior signal', () => {
    const summary = withSignals({
      ...SAMPLE_SCENARIOS.completionDrop,
      priorInsight: SAMPLE_PRIOR_INSIGHTS.samePatternPlain,
    });
    const prompt = buildInsightUserPrompt(summary);
    assert.match(prompt, /What Kenji said last time/);
    assert.match(prompt, /SAME underlying pattern continuing/);
  });

  test('shown for a "plain" reason with DIFFERENT-situation language on a non-matching prior signal', () => {
    const summary = withSignals({
      ...SAMPLE_SCENARIOS.completionDrop,
      priorInsight: SAMPLE_PRIOR_INSIGHTS.differentSituation,
    });
    const prompt = buildInsightUserPrompt(summary);
    assert.match(prompt, /What Kenji said last time/);
    assert.match(prompt, /DIFFERENT situation than last time/);
  });

  test('fully suppressed for overachievement_tradeoff even with a matching prior signal', () => {
    const summary = withSignals({
      ...SAMPLE_SCENARIOS.overachievementTradeoffOneDropper,
      priorInsight: SAMPLE_PRIOR_INSIGHTS.samePatternStructurallyFull,
    });
    const prompt = buildInsightUserPrompt(summary);
    assert.doesNotMatch(prompt, /What Kenji said last time/);
  });

  test('fully suppressed for sustained_underdelivery regardless of priorInsight', () => {
    const summary = withSignals(
      {
        ...SAMPLE_SCENARIOS.sustainedUnderdelivery,
        priorInsight: SAMPLE_PRIOR_INSIGHTS.differentSituation,
      },
      SAMPLE_OLDER_RATIOS_FOUR_WEEK_STREAK,
    );
    assert.ok(
      summary.signals.some((s) => s.reason === 'sustained_underdelivery'),
      'sanity: sustained_underdelivery actually fired in this fixture',
    );
    const prompt = buildInsightUserPrompt(summary);
    assert.doesNotMatch(prompt, /What Kenji said last time/);
  });

  test('absent entirely when priorInsight is null', () => {
    const summary = withSignals({ ...SAMPLE_SCENARIOS.completionDrop, priorInsight: null });
    const prompt = buildInsightUserPrompt(summary);
    assert.doesNotMatch(prompt, /What Kenji said last time/);
  });
});

describe('buildInsightUserPrompt — variety hints', () => {
  test('overachievement_tradeoff always gets a win/ease-verb variety hint', () => {
    const summary = withSignals(SAMPLE_SCENARIOS.overachievementTradeoffOneDropper);
    const prompt = buildInsightUserPrompt(summary, { random: () => 0.5 });
    assert.match(prompt, /For variety, use ".*" for the win half and ".*" for the pull-back verb/);
  });

  test('overachievement_tradeoff closing clause appears when random() rolls under the rate, not when it doesn\'t', () => {
    const summary = withSignals(SAMPLE_SCENARIOS.overachievementTradeoffOneDropper);
    const withClause = buildInsightUserPrompt(summary, { random: () => 0 });
    const withoutClause = buildInsightUserPrompt(summary, { random: () => 0.99 });
    assert.match(withClause, /use this exact closing clause/);
    assert.doesNotMatch(withoutClause, /use this exact closing clause/);
  });

  test('sustained_underdelivery gets a phrasing hint', () => {
    const summary = withSignals(SAMPLE_SCENARIOS.sustainedUnderdelivery, SAMPLE_OLDER_RATIOS_FOUR_WEEK_STREAK);
    assert.ok(summary.signals.some((s) => s.reason === 'sustained_underdelivery'), 'sanity check');
    const prompt = buildInsightUserPrompt(summary, { random: () => 0 });
    assert.match(prompt, /For variety, phrase it along the lines of/);
  });

  test('overall_decline_ambiguous gets a question-ending hint', () => {
    const summary = withSignals(SAMPLE_SCENARIOS.overallDeclineAmbiguous);
    const prompt = buildInsightUserPrompt(summary, { random: () => 0 });
    assert.match(prompt, /For variety, end with a question along these lines/);
  });

  test('a "plain" reason (completion_drop) gets no variety hint line at all', () => {
    const summary = withSignals(SAMPLE_SCENARIOS.completionDrop);
    const prompt = buildInsightUserPrompt(summary, { random: () => 0 });
    assert.doesNotMatch(prompt, /For variety/);
  });
});

describe('buildInsightUserPrompt — domain context', () => {
  test('lists every domain with its principle label', () => {
    const summary = withSignals(SAMPLE_SCENARIOS.twoIndependentProblems);
    const prompt = buildInsightUserPrompt(summary);
    for (const d of summary.domains) {
      assert.match(prompt, new RegExp(`- ${d.name} \\(`));
    }
  });
});
