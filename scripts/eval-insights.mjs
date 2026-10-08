#!/usr/bin/env node
// Headless eval for the AI Insights golden dataset. Requires a running
// dev server (pnpm dev) — it hits the real HTTP routes rather than
// importing the TS prompt/model code directly, so there's no build step
// and what it tests is exactly what a real request exercises.
//
// Checks are deterministic invariants, not text-equality: schema shape,
// silence-correctness for fixtures with an unambiguous expected answer
// (packages/insights/src/fixtures.ts `expectedShouldSpeak`), and length
// bounds. Fixtures without an expectedShouldSpeak are genuinely
// ambiguous LLM judgment calls — reported, never failed.
//
// Fixtures whose precomputed `summary.signals` is empty never call the
// model at all — computeWeeklySignals() already guarantees silence
// deterministically (see @ikigai/insights signals.ts), so this is a
// free, instant gate check, not an LLM invocation. Only fixtures with
// at least one signal spend real OpenAI credits, one call each.

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const MAX_INSIGHT_LENGTH = 140;

async function fetchFixtures() {
  const res = await fetch(`${BASE}/api/dev/insights-fixtures`);
  if (!res.ok) {
    throw new Error(
      `Couldn't fetch fixtures from ${BASE} (${res.status}). Is \`pnpm dev\` running?`,
    );
  }
  const body = await res.json();
  return body.fixtures;
}

function checkGate(fixture) {
  // No signals means the client and server both short-circuit to
  // silent without ever calling the model — verify that guarantee
  // directly against the fixture data, no network involved.
  const problems = [];
  let status = 'INFO';
  if (typeof fixture.expectedShouldSpeak === 'boolean') {
    status = fixture.expectedShouldSpeak === false ? 'PASS' : 'FAIL';
    if (status === 'FAIL') {
      problems.push(
        `expected shouldSpeak=${fixture.expectedShouldSpeak}, but signals is empty so the real app would never call the model (always false)`,
      );
    }
  }
  return {
    fixture,
    latencyMs: 0,
    body: { shouldSpeak: false },
    problems,
    status,
    gated: true,
  };
}

async function runFixture(fixture) {
  if (!fixture.summary.signals || fixture.summary.signals.length === 0) {
    return checkGate(fixture);
  }

  const startedAt = Date.now();
  const res = await fetch(`${BASE}/api/insights/weekly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: fixture.summary }),
  });
  const latencyMs = Date.now() - startedAt;
  const body = await res.json().catch(() => null);

  const problems = [];
  if (!res.ok || !body || typeof body.shouldSpeak !== 'boolean') {
    problems.push(
      `bad response shape (HTTP ${res.status}): ${JSON.stringify(body)}`,
    );
    return { fixture, latencyMs, body, problems, status: 'FAIL' };
  }

  if (body.shouldSpeak) {
    if (typeof body.insight !== 'string' || body.insight.length === 0) {
      problems.push('shouldSpeak=true but insight is missing/empty');
    } else if (body.insight.length > MAX_INSIGHT_LENGTH) {
      problems.push(
        `insight is ${body.insight.length} chars, over the ${MAX_INSIGHT_LENGTH} limit`,
      );
    }
  }

  let status = 'INFO';
  if (typeof fixture.expectedShouldSpeak === 'boolean') {
    if (body.shouldSpeak === fixture.expectedShouldSpeak) {
      status = problems.length > 0 ? 'FAIL' : 'PASS';
    } else {
      problems.push(
        `expected shouldSpeak=${fixture.expectedShouldSpeak}, got ${body.shouldSpeak}`,
      );
      status = 'FAIL';
    }
  } else if (problems.length > 0) {
    status = 'FAIL';
  }

  return { fixture, latencyMs, body, problems, status };
}

async function main() {
  console.log(`Fetching golden dataset from ${BASE}...`);
  const fixtures = await fetchFixtures();
  console.log(`Running ${fixtures.length} fixtures against /api/insights/weekly...\n`);

  const results = [];
  for (const fixture of fixtures) {
    process.stdout.write(`  ${fixture.label}... `);
    const result = await runFixture(fixture);
    results.push(result);
    console.log(
      result.gated
        ? `${result.status} (gated — no API call)`
        : `${result.status} (${result.latencyMs}ms)`,
    );
  }

  console.log('\n--- Details ---\n');
  for (const { fixture, body, problems, status } of results) {
    console.log(`[${status}] ${fixture.label}`);
    console.log(`  expectation: ${fixture.expectation}`);
    if (body?.shouldSpeak) {
      console.log(`  actual: shouldSpeak=true — "${body.insight}"`);
    } else if (body) {
      console.log(`  actual: shouldSpeak=false`);
    }
    problems.forEach((p) => console.log(`  ⚠ ${p}`));
    console.log('');
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const passed = results.filter((r) => r.status === 'PASS');
  const info = results.filter((r) => r.status === 'INFO');
  console.log(
    `${passed.length} passed, ${failed.length} failed, ${info.length} informational (no ground truth) — ${results.length} total.`,
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Eval script failed:', err.message);
  process.exitCode = 1;
});
