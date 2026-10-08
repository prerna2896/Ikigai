import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  weeklyMetricsSummarySchema,
  buildInsightSystemPrompt,
  buildInsightUserPrompt,
} from '@ikigai/insights';

// The only place the OpenAI key is ever used. Takes a client-computed
// weekly summary (see @ikigai/insights buildWeeklyMetricsSummary) and
// returns a judgment — this route has no database access of any kind,
// which is what makes it work identically for signed-in and signed-out
// users: the client already knows how to read its own data (local or
// cloud), this route only judges what it's handed.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestBodySchema = z.object({ summary: weeklyMetricsSummarySchema });

const modelResultSchema = z.object({
  shouldSpeak: z.boolean(),
  // Targets are ~100 chars normally, up to 140 for the prompt's stated
  // two-signal/question exceptions (see prompt.ts rules 2d/3) — this
  // 180 cap is a SAFETY VALVE above that, not the target. generateObject
  // throws the whole call out on any schema mismatch with no partial
  // credit, so a model response that runs a bit long for genuinely
  // wordy reasons (real observed cause: an invented trailing clause,
  // since fixed in the prompt) used to fail the ENTIRE insight instead
  // of just being longer than ideal. Keep this well above the prompt's
  // real targets so an occasional overshoot degrades gracefully instead
  // of hard-failing; the prompt is what should keep length in check day
  // to day, not this ceiling.
  insight: z.string().min(1).max(180).optional(),
  // Which of the two speak-worthy cases this is — lets the UI reflect it
  // visually (e.g. a smiling vs. calm Kenji), not just in the copy.
  // Unset when shouldSpeak is false.
  tone: z.enum(['celebrate', 'attention']).optional(),
});

// Zero-infra abuse guard. Imperfect across serverless cold starts /
// multiple instances, but the client-side cache (see
// lib/useWeeklyInsight.ts) means legitimate usage never approaches this
// rate — this only needs to deter direct-POST abuse of a route that
// calls a paid API with no other gate available. Skipped outside
// production: locally every request shares one key (`x-forwarded-for`
// is empty on localhost, so the key falls back to 'unknown' for
// everyone), and the playground that calls this route directly and
// repeatedly is already gated to non-production on its own — the two
// guards were stacking and blocking legitimate dev testing, not abuse.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const requestLog = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  const now = Date.now();
  const timestamps = (requestLog.get(key) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

export async function POST(request: Request) {
  const clientKey = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (isRateLimited(clientKey)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = requestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { summary } = parsed.data;

  // Defense-in-depth: the client (lib/useWeeklyInsight.ts) already
  // skips this call entirely when computeWeeklySignals found nothing
  // above threshold. If a request somehow arrives here anyway (a stale
  // client, the playground with hand-edited JSON, direct POST), don't
  // spend a model call asking it to re-derive a judgment that's already
  // deterministically "nothing." Silence is enforced at both layers.
  if (summary.signals.length === 0) {
    return NextResponse.json({ shouldSpeak: false });
  }

  try {
    const { object } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: modelResultSchema,
      system: buildInsightSystemPrompt(summary.personalityRead),
      prompt: buildInsightUserPrompt(summary),
    });

    if (!object.shouldSpeak || !object.insight) {
      return NextResponse.json({ shouldSpeak: false });
    }
    return NextResponse.json({
      shouldSpeak: true,
      insight: object.insight,
      tone: object.tone ?? 'attention',
      // Identifies this exact generation for reaction feedback (see
      // /api/insights/reaction) — a fresh id every call, not derived
      // from the summary, so reacting to a regenerated insight for the
      // same week never collides with a reaction on the previous one.
      insightId: crypto.randomUUID(),
    });
  } catch (err) {
    // An insight is a bonus, not something the user is ever blocked on —
    // no stack traces leak to the CLIENT, no user-facing error banner
    // either (the client treats any non-2xx as "no insight this time").
    // Still logged server-side — this used to be a silent catch, which
    // meant a real bug (e.g. a schema mismatch from the model's output)
    // and a transient OpenAI hiccup were indistinguishable from the
    // outside; nobody could tell which one was happening.
    console.error('[insights/weekly] generation failed:', err);
    return NextResponse.json({ error: 'Insight generation failed' }, { status: 502 });
  }
}
