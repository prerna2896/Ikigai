import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyMetricsSummary, hashWeeklySummary } from './buildWeeklySummary';
import {
  SAMPLE_PLAN_WITH_STANDOUT_TASK,
  SAMPLE_LOGS_WITH_STANDOUT_TASK_THIS_WEEK,
  SAMPLE_LOGS_WITH_STANDOUT_TASK_PRIOR_WEEK,
  SAMPLE_PLAN_EVENLY_SPREAD,
  SAMPLE_LOGS_EVENLY_SPREAD_THIS_WEEK,
  SAMPLE_LOGS_EVENLY_SPREAD_PRIOR_WEEK,
  SAMPLE_PLAN_SINGLE_TASK,
  SAMPLE_LOGS_SINGLE_TASK_THIS_WEEK,
  SAMPLE_LOGS_SINGLE_TASK_PRIOR_WEEK,
  SAMPLE_PERSONALITIES,
  SAMPLE_PERSONA_NOTES,
} from './sampleData';

const now = new Date('2026-09-16T12:00:00Z'); // mid-week for the standout-task plans (starts 2026-09-14)

function build(overrides: Partial<Parameters<typeof buildWeeklyMetricsSummary>[0]>) {
  return buildWeeklyMetricsSummary({
    weekPlan: SAMPLE_PLAN_WITH_STANDOUT_TASK,
    weekLogs: SAMPLE_LOGS_WITH_STANDOUT_TASK_THIS_WEEK,
    priorWeekPlan: SAMPLE_PLAN_WITH_STANDOUT_TASK,
    priorWeekLogs: SAMPLE_LOGS_WITH_STANDOUT_TASK_PRIOR_WEEK,
    reflectionNoteCount: 0,
    contextNote: null,
    personalityRead: SAMPLE_PERSONALITIES.balanced,
    now,
    ...overrides,
  });
}

describe('buildWeeklyMetricsSummary — aggregation', () => {
  test('sums task hours into the correct domain-level totals', () => {
    const summary = build({});
    const domain = summary.domains.find((d) => d.name === 'Creative Hobbies');
    assert.ok(domain);
    // watercolor: 8+4=12, journal: 1 → domain total 13
    assert.equal(domain.loggedHours, 13);
    assert.equal(domain.plannedHours, 10);
  });

  test('prior week totals come from the prior plan/logs, not the current week', () => {
    const summary = build({});
    const domain = summary.domains.find((d) => d.name === 'Creative Hobbies');
    assert.ok(domain);
    // prior: watercolor 2 + journal 1 = 3 logged, 10 planned → 0.3 ratio
    assert.equal(domain.priorCompletionRatio, 0.3);
  });

  test('no prior week plan → priorPlannedHours/priorCompletionRatio are null', () => {
    const summary = build({ priorWeekPlan: null, priorWeekLogs: [] });
    const domain = summary.domains.find((d) => d.name === 'Creative Hobbies');
    assert.ok(domain);
    assert.equal(domain.priorPlannedHours, null);
    assert.equal(domain.priorCompletionRatio, null);
  });

  test('personaNote passes through unchanged, defaults to null when omitted', () => {
    assert.equal(build({}).personaNote, null);
    assert.equal(build({ personaNote: SAMPLE_PERSONA_NOTES.selfCritical }).personaNote, SAMPLE_PERSONA_NOTES.selfCritical);
  });
});

describe('buildWeeklyMetricsSummary — computeTopTask (via topTask on the built domain)', () => {
  test('a clearly dominant task is surfaced as topTask', () => {
    const summary = build({});
    const domain = summary.domains.find((d) => d.name === 'Creative Hobbies');
    assert.ok(domain?.topTask);
    assert.equal(domain.topTask.name, 'watercolor sketches');
  });

  test('an evenly-spread change across 3 tasks (none reaching 50% share) yields topTask: null', () => {
    const summary = build({
      weekPlan: SAMPLE_PLAN_EVENLY_SPREAD,
      weekLogs: SAMPLE_LOGS_EVENLY_SPREAD_THIS_WEEK,
      priorWeekPlan: SAMPLE_PLAN_EVENLY_SPREAD,
      priorWeekLogs: SAMPLE_LOGS_EVENLY_SPREAD_PRIOR_WEEK,
    });
    const domain = summary.domains.find((d) => d.name === 'Creative Hobbies');
    assert.equal(domain?.topTask, null);
  });

  test('a domain with only 1 task never gets a topTask, regardless of how much it moved', () => {
    const summary = build({
      weekPlan: SAMPLE_PLAN_SINGLE_TASK,
      weekLogs: SAMPLE_LOGS_SINGLE_TASK_THIS_WEEK,
      priorWeekPlan: SAMPLE_PLAN_SINGLE_TASK,
      priorWeekLogs: SAMPLE_LOGS_SINGLE_TASK_PRIOR_WEEK,
    });
    const domain = summary.domains.find((d) => d.name === 'Work');
    assert.equal(domain?.topTask, null);
  });

  test('no prior week at all → topTask is null even with 2+ tasks (no baseline to compare)', () => {
    const summary = build({ priorWeekPlan: null, priorWeekLogs: [] });
    const domain = summary.domains.find((d) => d.name === 'Creative Hobbies');
    assert.equal(domain?.topTask, null);
  });
});

describe('buildWeeklyMetricsSummary — daysElapsedInWeek clamping', () => {
  test('clamps to 7 when `now` is well past the week', () => {
    const summary = build({ now: new Date('2026-10-01T00:00:00Z') });
    assert.equal(summary.daysElapsedInWeek, 7);
  });

  test('clamps to 0 when `now` is before the week starts', () => {
    const summary = build({ now: new Date('2026-09-01T00:00:00Z') });
    assert.equal(summary.daysElapsedInWeek, 0);
  });
});

describe('hashWeeklySummary', () => {
  test('identical summaries hash identically', () => {
    const a = build({});
    const b = build({});
    assert.equal(hashWeeklySummary(a), hashWeeklySummary(b));
  });

  test('a materially different summary hashes differently', () => {
    const a = build({});
    const b = build({ weekLogs: SAMPLE_LOGS_EVENLY_SPREAD_THIS_WEEK });
    assert.notEqual(hashWeeklySummary(a), hashWeeklySummary(b));
  });

  test('a different persona note hashes differently', () => {
    const a = build({ personaNote: null });
    const b = build({ personaNote: SAMPLE_PERSONA_NOTES.selfCritical });
    assert.notEqual(hashWeeklySummary(a), hashWeeklySummary(b));
  });
});
