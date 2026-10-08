import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Records a reaction (heart / thumbs up / thumbs down) to a generated
// insight, for later review — not a user-facing read, write-only. Uses
// the service-role key (bypasses RLS) since this is the one deliberate
// exception to "AI Insights routes never touch a database": unlike
// /api/insights/weekly, this never reads a user's planning data back,
// it only records a reaction to text already shown to them locally, so
// it doesn't compromise the local-first design and works identically
// for signed-in and signed-out users (userId is optional — omitted
// means a local-only user reacted).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestBodySchema = z.object({
  insightId: z.string().min(1).max(100),
  weekId: z.string().min(1).max(40),
  reaction: z.enum(['heart', 'thumbs_up', 'thumbs_down']),
  tone: z.enum(['celebrate', 'attention']).optional(),
  signalReasons: z.array(z.string().max(40)).max(20).default([]),
  insightText: z.string().min(1).max(200),
  userId: z.string().uuid().optional(),
});

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
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

  const client = getServiceClient();
  if (!client) {
    // Cloud env vars aren't configured (e.g. a bare local checkout) —
    // feedback is a bonus, not something to error the UI over.
    return NextResponse.json({ ok: false });
  }

  const { insightId, weekId, reaction, tone, signalReasons, insightText, userId } =
    parsed.data;

  const { error } = await client.from('insight_reactions').upsert(
    {
      insight_id: insightId,
      user_id: userId ?? null,
      week_id: weekId,
      reaction,
      tone: tone ?? null,
      signal_reasons: signalReasons,
      insight_text: insightText,
    },
    { onConflict: 'insight_id' },
  );

  if (error) {
    return NextResponse.json({ error: 'Could not record reaction' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
