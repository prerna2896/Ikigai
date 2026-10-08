import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeeklySignals, selectSignalsForInsight, principleLabelFor } from './signals';
import {
  SAMPLE_DOMAINS,
  SAMPLE_OLDER_RATIOS_FOUR_WEEK_STREAK,
  SAMPLE_OLDER_RATIOS_BROKEN_STREAK,
  SAMPLE_SCENARIOS,
} from './sampleData';

describe('computeWeeklySignals — gating', () => {
  test('no prior week anywhere → returns [] unconditionally', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.firstTrackedWeek);
    assert.deepEqual(signals, []);
  });

  test('nothing crosses threshold → returns [] (silence)', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.silence);
    assert.deepEqual(signals, []);
  });
});

describe('computeWeeklySignals — one per SignalReason', () => {
  test('completion_drop fires with the right domain and principle label', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.completionDrop);
    const s = signals.find((s) => s.reason === 'completion_drop');
    assert.ok(s, 'completion_drop should fire');
    assert.equal(s.domainName, 'Health');
    assert.equal(s.kind, 'attention');
    assert.equal(s.scope, 'domain');
    assert.match(s.detail, /Energy/); // 'energy' principle, unique in this fixture set
  });

  test('completion_improved fires as a celebrate signal', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.completionImproved);
    const s = signals.find((s) => s.reason === 'completion_improved');
    assert.ok(s, 'completion_improved should fire');
    assert.equal(s.kind, 'celebrate');
    assert.equal(s.domainName, 'Learning');
  });

  test('sustained_strong fires when >=85% two weeks running', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.sustainedStrong);
    const s = signals.find((s) => s.reason === 'sustained_strong');
    assert.ok(s, 'sustained_strong should fire');
    assert.equal(s.kind, 'celebrate');
  });

  test('allocation_drop fires and takes priority over a completion signal on the same domain', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.allocationDrop);
    const domainSignals = signals.filter((s) => s.domainName === 'Side Project');
    assert.equal(domainSignals.length, 1, 'exactly one signal for the domain, not both allocation and completion');
    assert.equal(domainSignals[0].reason, 'allocation_drop');
  });

  test('overachievement_tradeoff (1 dropper): names win domain + the one dropped domain, attention kind', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.overachievementTradeoffOneDropper);
    const s = signals.find((s) => s.reason === 'overachievement_tradeoff');
    assert.ok(s, 'overachievement_tradeoff should fire');
    assert.equal(s.kind, 'attention', 'never celebrate — a real domain dropped for this to fire at all');
    assert.equal(s.domainName, 'Work');
    assert.deepEqual(s.relatedDomainNames, ['Health']);
    // The dropped domain's own standalone completion_drop must be folded
    // into the tradeoff, not ALSO reported as its own separate signal —
    // Health should appear only inside relatedDomainNames above, never
    // as a signal with its own domainName.
    assert.equal(signals.filter((sig) => sig.domainName === 'Health').length, 0);
  });

  test('overachievement_tradeoff (2 droppers): names up to 2 related domains, most severe first', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.overachievementTradeoffTwoDroppers);
    const s = signals.find((s) => s.reason === 'overachievement_tradeoff');
    assert.ok(s);
    assert.equal(s.relatedDomainNames?.length, 2);
    assert.ok(s.relatedDomainNames?.includes('Health'));
    assert.ok(s.relatedDomainNames?.includes('Family'));
  });

  test('overachievement_tradeoff carries the win domain\'s topTask name when it has a qualifying one', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.overachievementTradeoffWithStandoutTask);
    const s = signals.find((s) => s.reason === 'overachievement_tradeoff');
    assert.ok(s);
    assert.equal(s.taskName, 'watercolor sketches');
    // The task name is baked directly into detail (nameFor), not left as
    // a separate model-facing hint — see signals.ts's nameFor.
    assert.match(s.detail, /watercolor sketches/);
    assert.doesNotMatch(s.detail, /Alignment/, 'principle label should NOT also appear once task name is used');
  });

  test('sustained_underdelivery fires on a genuine 4-week streak', () => {
    const signals = computeWeeklySignals(
      SAMPLE_SCENARIOS.sustainedUnderdelivery,
      SAMPLE_OLDER_RATIOS_FOUR_WEEK_STREAK,
    );
    const s = signals.find((s) => s.reason === 'sustained_underdelivery');
    assert.ok(s, 'sustained_underdelivery should fire on a 4-week streak');
    assert.doesNotMatch(s.detail, /dropped|declined/i, 'must never use recent-change language for a chronic pattern');
  });

  test('sustained_underdelivery does NOT fire when the streak broke 2 weeks back', () => {
    const signals = computeWeeklySignals(
      SAMPLE_SCENARIOS.sustainedUnderdelivery,
      SAMPLE_OLDER_RATIOS_BROKEN_STREAK,
    );
    const s = signals.find((s) => s.reason === 'sustained_underdelivery');
    assert.equal(s, undefined);
  });

  test('overall_decline_ambiguous fires when totals dropped and no domain explains it', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.overallDeclineAmbiguous);
    const s = signals.find((s) => s.reason === 'overall_decline_ambiguous');
    assert.ok(s, 'overall_decline_ambiguous should fire');
    assert.equal(s.scope, 'overall');
    assert.equal(s.domainName, undefined);
  });

  test('overall_decline_ambiguous does NOT fire when a reallocation story already explains the drop', () => {
    // overachievementTradeoffOneDropper: totals moved but Work rising
    // explains it — the ambiguous/overall check must not also fire.
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.overachievementTradeoffOneDropper);
    assert.equal(signals.find((s) => s.reason === 'overall_decline_ambiguous'), undefined);
  });
});

describe('selectSignalsForInsight', () => {
  test('a solo signal is selected as-is', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.completionDrop);
    const selected = selectSignalsForInsight(signals, SAMPLE_SCENARIOS.completionDrop.domains);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].reason, 'completion_drop');
  });

  test('overall_decline_ambiguous wins alone, never combined with anything else', () => {
    // Build a scenario where overall_decline_ambiguous AND a domain
    // problem both exist in the raw signal list — selection must still
    // return only the overall one.
    const domains = [
      SAMPLE_DOMAINS.steady,
      { ...SAMPLE_DOMAINS.completionDrop, plannedHours: 3, loggedHours: 1, priorPlannedHours: 3 }, // below MIN_MEANINGFUL_HOURS for completion check but still drags totals down
    ];
    const base = {
      weekId: 'w', daysElapsedInWeek: 5,
      totals: { plannedHours: 20, loggedHours: 10, completionRatio: 0.5 },
      domains,
      priorWeek: { plannedHours: 20, loggedHours: 15, completionRatio: 0.75 },
      goals: [], reflectionNoteCount: 0, contextNote: null,
      personalityRead: { structureTolerance: 'balanced' as const, highEmotionalSensitivity: false, coachingStyle: 'balanced' as const },
      priorInsight: null,
    };
    const signals = computeWeeklySignals(base);
    const overall = signals.find((s) => s.reason === 'overall_decline_ambiguous');
    assert.ok(overall, 'sanity: overall_decline_ambiguous actually fired in this fixture');
    const selected = selectSignalsForInsight(signals, domains);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].reason, 'overall_decline_ambiguous');
  });

  test('two independent problems are combined over a solo tradeoff', () => {
    const signals = computeWeeklySignals(SAMPLE_SCENARIOS.twoIndependentProblems);
    const selected = selectSignalsForInsight(signals, SAMPLE_SCENARIOS.twoIndependentProblems.domains);
    assert.equal(selected.length, 2);
    const reasons = selected.map((s) => s.reason).sort();
    assert.deepEqual(reasons, ['allocation_drop', 'completion_drop']);
  });

  test('overachievement_tradeoff is excluded from the "independent problems" combinable pool', () => {
    // A tradeoff plus exactly ONE other independent problem should NOT
    // combine into two — the tradeoff never joins as one of the two.
    const domains = [
      SAMPLE_DOMAINS.overachieving,
      SAMPLE_DOMAINS.completionDrop,
      domain2(),
    ];
    function domain2() {
      return {
        name: 'Side Project', principleId: 'growth' as const,
        plannedHours: 4, loggedHours: 3, completionRatio: 0.75,
        taskCount: 1, completedTaskCount: 0,
        priorPlannedHours: 8, priorCompletionRatio: 0.7,
        topTask: null,
      };
    }
    const base = {
      weekId: 'w', daysElapsedInWeek: 5,
      totals: { plannedHours: 30, loggedHours: 25, completionRatio: 0.83 },
      domains,
      priorWeek: { plannedHours: 30, loggedHours: 22, completionRatio: 0.73 },
      goals: [], reflectionNoteCount: 0, contextNote: null,
      personalityRead: { structureTolerance: 'balanced' as const, highEmotionalSensitivity: false, coachingStyle: 'balanced' as const },
      priorInsight: null,
    };
    const signals = computeWeeklySignals(base);
    const selected = selectSignalsForInsight(signals, domains);
    // allocation_drop (Side Project) is the only OTHER independent
    // problem once Health is folded into the tradeoff — only one
    // independent problem exists, so it should fall back to the single
    // top signal, not force a pairing with the tradeoff.
    assert.equal(selected.length, 1);
  });
});

describe('principleLabelFor', () => {
  test('uses the principle label when exactly one domain shares that principle', () => {
    const domains = [SAMPLE_DOMAINS.steady, SAMPLE_DOMAINS.completionDrop]; // contribution, energy — no overlap
    assert.equal(principleLabelFor(domains, SAMPLE_DOMAINS.steady), 'Contribution');
  });

  test('falls back to the raw domain name when two+ domains share a principle', () => {
    const alsoGrowth = { ...SAMPLE_DOMAINS.completionImproved, name: 'Side Project' }; // both 'growth'
    const domains = [SAMPLE_DOMAINS.completionImproved, alsoGrowth];
    assert.equal(principleLabelFor(domains, SAMPLE_DOMAINS.completionImproved), 'Learning');
    assert.equal(principleLabelFor(domains, alsoGrowth), 'Side Project');
  });
});
