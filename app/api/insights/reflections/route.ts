import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  buildReflectionAnalysisSystemPrompt,
  buildReflectionAnalysisUserPrompt,
  reflectionAnalysisResultSchema,
} from '@ikigai/insights';

// A deliberate, explicit exception to the rest of AI Insights' zero-
// raw-text stance (see packages/insights/src/summary.ts) — this route
// exists specifically to tag reflection TEXT (domain relevance + mood),
// which only works by actually reading it. Scoped narrowly on purpose:
// this only ever returns short tags, never a summary or quote of the
// reflections themselves, and still has no database access — the
// client already has the reflections (from its own repo) and sends
// exactly what it wants tagged.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestBodySchema = z.object({
  reflections: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        categoryId: z.string().max(40).nullable(),
        // Defensive truncation, same reasoning as goal text elsewhere —
        // nothing upstream enforces a length cap on write.
        text: z.string().min(1).max(500),
      }),
    )
    .max(30),
  domainNames: z.array(z.string().max(80)).max(10),
});

// Skipped outside production — see the matching guard in
// app/api/insights/weekly/route.ts for why: locally every request
// shares one rate-limit key, and the playground that calls this route
// directly and repeatedly is already gated to non-production on its
// own, so this was blocking legitimate dev testing, not abuse.
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

  const { reflections, domainNames } = parsed.data;
  if (reflections.length === 0) {
    return NextResponse.json({ tags: [] });
  }

  try {
    const { object } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: reflectionAnalysisResultSchema,
      system: buildReflectionAnalysisSystemPrompt(),
      prompt: buildReflectionAnalysisUserPrompt(reflections, domainNames),
    });
    return NextResponse.json(object);
  } catch (err) {
    console.error('[insights/reflections] analysis failed:', err);
    // Same bonus-not-blocking treatment as /api/insights/weekly — the
    // encouraging line just doesn't show this time.
    return NextResponse.json({ tags: [] }, { status: 502 });
  }
}
