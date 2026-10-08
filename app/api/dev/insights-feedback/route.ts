import { NextResponse } from 'next/server';
import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

// Persists playground feedback (reaction + freeform note + the signals
// and tone that produced the insight) to a local file, so it survives
// across sessions for prompt tuning — unlike the JSON editor state,
// which lives only in the browser tab, and unlike
// /api/insights/reaction, which records REAL end-user reactions to
// Supabase. Playground/dev testing data must stay out of that table
// (see app/api/insights/reaction/route.ts) — this is a deliberately
// separate, local-only sink.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const feedbackSchema = z.object({
  fixtureLabel: z.string().max(200),
  tone: z.enum(['celebrate', 'attention']).nullable(),
  insightText: z.string().max(300).nullable(),
  signals: z
    .array(
      z.object({
        kind: z.enum(['celebrate', 'attention']),
        scope: z.enum(['overall', 'domain']),
        domainName: z.string().max(80).optional(),
        reason: z.string().max(40),
        detail: z.string().max(300),
      }),
    )
    .max(20),
  reaction: z.enum(['heart', 'thumbs_up', 'thumbs_down']).nullable(),
  note: z.string().max(1000).nullable().optional(),
});

const FEEDBACK_FILE = path.join(process.cwd(), '.data', 'insights-playground-feedback.jsonl');

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const entry = { ...parsed.data, recordedAt: new Date().toISOString() };

  try {
    await mkdir(path.dirname(FEEDBACK_FILE), { recursive: true });
    await appendFile(FEEDBACK_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    return NextResponse.json({ error: 'Could not save feedback' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
