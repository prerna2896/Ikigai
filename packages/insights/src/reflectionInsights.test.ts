import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  encouragementLineFor,
  buildReflectionAnalysisUserPrompt,
  reflectionTagSchema,
  reflectionAnalysisResultSchema,
} from './reflectionInsights';
import { SAMPLE_REFLECTIONS, SAMPLE_REFLECTION_BATCH, SAMPLE_DOMAIN_NAMES } from './sampleData';

describe('encouragementLineFor', () => {
  test('returns null for null or undefined mood — no reflection data means no line', () => {
    assert.equal(encouragementLineFor('Work', null), null);
    assert.equal(encouragementLineFor('Work', undefined), null);
  });

  const moods = ['positive', 'mixed', 'negative', 'neutral'] as const;
  for (const mood of moods) {
    test(`${mood}: returns a non-empty line containing the domain label`, () => {
      const line = encouragementLineFor('Work', mood, () => 0);
      assert.ok(line);
      assert.match(line, /Work/);
    });
  }

  test('never quotes or paraphrases raw reflection text — only the domain label is substituted', () => {
    // Every template is a closed, pre-written set — this test exists to
    // catch a future regression where someone starts interpolating
    // reflection content directly, which the file-level comment
    // explicitly rules out.
    const line = encouragementLineFor('Health', 'negative', () => 0);
    assert.ok(line);
    assert.doesNotMatch(line, /gym|drained|guilty/i); // none of SAMPLE_REFLECTIONS.negative's words
  });

  test('random() controls which template is picked, and varies the output', () => {
    const seen = new Set<string | null>();
    // Sweep across the [0,1) range — with 3 templates per mood, this
    // should hit at least 2 distinct ones.
    for (const r of [0, 0.34, 0.67, 0.99]) {
      seen.add(encouragementLineFor('Work', 'positive', () => r));
    }
    assert.ok(seen.size >= 2, `expected variety across the random range, got ${seen.size} distinct line(s)`);
  });

  test('random() = 0 and random() just under 1 both resolve to valid, in-bounds templates (no off-by-one)', () => {
    const first = encouragementLineFor('Work', 'neutral', () => 0);
    const last = encouragementLineFor('Work', 'neutral', () => 0.9999);
    assert.ok(first);
    assert.ok(last);
  });

  test('domain label substitution works for a multi-word label', () => {
    const line = encouragementLineFor('Creative Hobbies', 'mixed', () => 0);
    assert.match(line!, /Creative Hobbies/);
  });
});

describe('buildReflectionAnalysisUserPrompt', () => {
  test('lists every given domain name', () => {
    const prompt = buildReflectionAnalysisUserPrompt([SAMPLE_REFLECTIONS.positive], SAMPLE_DOMAIN_NAMES);
    for (const name of SAMPLE_DOMAIN_NAMES) {
      assert.match(prompt, new RegExp(`- ${name}`));
    }
  });

  test('empty domain list renders the explicit "(none)" fallback, not a blank section', () => {
    const prompt = buildReflectionAnalysisUserPrompt([SAMPLE_REFLECTIONS.positive], []);
    assert.match(prompt, /\(none\)/);
  });

  test('includes every reflection id and falls back to "note" for a null categoryId', () => {
    const noCategory = { id: 'r-nocat', categoryId: null, text: 'just a note' };
    const prompt = buildReflectionAnalysisUserPrompt([noCategory], SAMPLE_DOMAIN_NAMES);
    assert.match(prompt, /reflectionId="r-nocat"/);
    assert.match(prompt, /\[note\]/);
  });

  test('a full batch of reflections all appear in the prompt', () => {
    const prompt = buildReflectionAnalysisUserPrompt(SAMPLE_REFLECTION_BATCH, SAMPLE_DOMAIN_NAMES);
    for (const r of SAMPLE_REFLECTION_BATCH) {
      assert.match(prompt, new RegExp(`reflectionId="${r.id}"`));
    }
  });
});

describe('reflectionTagSchema / reflectionAnalysisResultSchema — zod validation', () => {
  test('accepts a well-formed tag', () => {
    const result = reflectionTagSchema.safeParse({ reflectionId: 'r1', domainName: 'Work', mood: 'positive' });
    assert.ok(result.success);
  });

  test('accepts domainName: null (unmatched reflection — the expected common case)', () => {
    const result = reflectionTagSchema.safeParse({ reflectionId: 'r1', domainName: null, mood: 'neutral' });
    assert.ok(result.success);
  });

  test('rejects an invalid mood value', () => {
    const result = reflectionTagSchema.safeParse({ reflectionId: 'r1', domainName: null, mood: 'ecstatic' });
    assert.equal(result.success, false);
  });

  test('rejects more than 30 tags in a result', () => {
    const tags = Array.from({ length: 31 }, (_, i) => ({
      reflectionId: `r${i}`, domainName: null, mood: 'neutral' as const,
    }));
    const result = reflectionAnalysisResultSchema.safeParse({ tags });
    assert.equal(result.success, false);
  });

  test('accepts exactly 30 tags', () => {
    const tags = Array.from({ length: 30 }, (_, i) => ({
      reflectionId: `r${i}`, domainName: null, mood: 'neutral' as const,
    }));
    const result = reflectionAnalysisResultSchema.safeParse({ tags });
    assert.ok(result.success);
  });
});
