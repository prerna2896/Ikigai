import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { weeklyMetricsSummarySchema, derivePersonalityRead } from '@ikigai/insights';
import type { ProfileReflection } from '@ikigai/core';
import {
  checkForCrisisLanguage,
  CRISIS_RESOURCE_RESPONSE,
  determineConversationId,
  isPersonaStale,
  isRecentInteractionStale,
  buildContextSummarizationSystemPrompt,
  buildPersonaSummarizationUserPrompt,
  buildRecentInteractionSummarizationUserPrompt,
  contextSummaryResultSchema,
  buildReplySystemPrompt,
  buildReplyUserPrompt,
  replyResultSchema,
  type CompanionMessage,
  type CompanionContext,
} from '@ikigai/companion';
import { createClient } from '../../../../lib/supabase/server';

// Stateful, signed-in-only companion chat — deliberately kept fully
// separate from the zero-DB /api/insights/weekly route (see
// docs/specs/ai-companion.md). Unlike that route, a failure here
// surfaces as a real error: a companion reply is the entire point of
// the request, not a bonus the UI can silently drop.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestBodySchema = z.object({
  message: z.string().min(1).max(2000),
  // Client-computed, same trust model /api/insights/weekly already
  // uses — re-deriving this server-side would duplicate
  // buildWeeklyMetricsSummary's actively-evolving aggregation logic in
  // a second place. Optional: a companion conversation should still
  // work even before any week has been planned.
  weeklySummary: weeklyMetricsSummarySchema.optional(),
});

// Same in-memory, production-only rate limit as /api/insights/weekly —
// see that file for why it's skipped outside production.
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

const PERSONA_SOURCE_WINDOW = 40;
const CONVERSATION_TURN_LIMIT = 20;

type MessageRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  crisis_flag: boolean;
  created_at: string;
};

function rowToMessage(row: MessageRow): CompanionMessage {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    crisisFlag: row.crisis_flag,
    createdAt: row.created_at,
  };
}

type ContextRow = {
  user_id: string;
  persona_summary: string;
  persona_updated_at: string | null;
  persona_source_message_count: number;
  recent_interaction_summary: string;
  recent_interaction_updated_at: string | null;
  recent_interaction_conversation_id: string | null;
};

function rowToContext(row: ContextRow): CompanionContext {
  return {
    userId: row.user_id,
    personaSummary: row.persona_summary,
    personaUpdatedAt: row.persona_updated_at,
    personaSourceMessageCount: row.persona_source_message_count,
    recentInteractionSummary: row.recent_interaction_summary,
    recentInteractionUpdatedAt: row.recent_interaction_updated_at,
    recentInteractionConversationId: row.recent_interaction_conversation_id,
  };
}

function formatWeeklySignals(
  weeklySummary: z.infer<typeof weeklyMetricsSummarySchema> | undefined,
): string {
  if (!weeklySummary || weeklySummary.signals.length === 0) return '';
  return weeklySummary.signals.map((s) => `- [${s.kind}] ${s.detail}`).join('\n');
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
  const { message, weeklySummary } = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  // ─── Safety gate: before any other logic, before any model call ────────
  // Deterministic, never LLM-judged. See @ikigai/companion safety.ts.
  const crisisCheck = checkForCrisisLanguage(message);

  const now = new Date();
  const { data: lastRow } = await supabase
    .from('companion_messages')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastMessage = lastRow ? rowToMessage(lastRow as MessageRow) : null;
  const conversationId = determineConversationId({ lastMessage, now });

  if (crisisCheck.matched) {
    const { error } = await supabase.from('companion_messages').insert([
      {
        id: crypto.randomUUID(),
        user_id: user.id,
        conversation_id: conversationId,
        role: 'user',
        content: message,
        crisis_flag: true,
      },
      {
        id: crypto.randomUUID(),
        user_id: user.id,
        conversation_id: conversationId,
        role: 'assistant',
        content: CRISIS_RESOURCE_RESPONSE,
        crisis_flag: true,
      },
    ]);
    if (error) {
      console.error('[companion/message] failed to persist crisis exchange:', error);
    }
    return NextResponse.json({
      reply: CRISIS_RESOURCE_RESPONSE,
      conversationId,
      crisis: true,
    });
  }

  try {
    // ─── Gather context ────────────────────────────────────────────────
    const [contextRes, countRes, sessionRes, reflectionsRes] = await Promise.all([
      supabase.from('companion_context').select('*').eq('user_id', user.id).maybeSingle(),
      supabase
        .from('companion_messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('companion_messages')
        .select('*')
        .eq('user_id', user.id)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(CONVERSATION_TURN_LIMIT),
      supabase.from('profile_reflections').select('question_id, answer').eq('user_id', user.id),
    ]);

    const context = contextRes.data ? rowToContext(contextRes.data as ContextRow) : null;
    const totalMessageCount = countRes.count ?? 0;
    const conversationTurns = ((sessionRes.data ?? []) as MessageRow[]).map(rowToMessage);
    const reflections: ProfileReflection[] = (reflectionsRes.data ?? []).map((r) => ({
      questionId: r.question_id,
      answer: r.answer,
    }));
    const personalityRead = derivePersonalityRead(reflections);

    let personaSummary = context?.personaSummary ?? '';
    let recentInteractionSummary = context?.recentInteractionSummary ?? '';
    let contextChanged = false;
    const contextUpdate: Record<string, unknown> = {};

    // ─── Persona recompute (slow tier) ──────────────────────────────────
    if (isPersonaStale({ context, totalMessageCount, now })) {
      try {
        const { data: recentRows } = await supabase
          .from('companion_messages')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(PERSONA_SOURCE_WINDOW - 1);
        // The current turn's OWN user message hasn't been inserted yet —
        // both rows are only persisted at the very end of this handler —
        // so recentRows above is history from BEFORE this turn. On a
        // brand-new user's very first message it comes back empty, and
        // the summarization call would otherwise see nothing at all,
        // including the one message that made isPersonaStale true in
        // the first place. Fold in a synthetic, not-yet-persisted
        // CompanionMessage for it so the summarizer sees what just
        // triggered it. The assistant's reply doesn't exist yet at this
        // point and is deliberately NOT included — only the user's half
        // of this turn has happened.
        const pendingUserMessage: CompanionMessage = {
          id: crypto.randomUUID(),
          userId: user.id,
          conversationId,
          role: 'user',
          content: message,
          crisisFlag: false,
          createdAt: now.toISOString(),
        };
        const newMessages = [
          ...((recentRows ?? []) as MessageRow[]).map(rowToMessage).reverse(),
          pendingUserMessage,
        ];
        const { object } = await generateObject({
          model: openai('gpt-4o-mini'),
          schema: contextSummaryResultSchema,
          system: buildContextSummarizationSystemPrompt('persona'),
          prompt: buildPersonaSummarizationUserPrompt({
            priorPersonaSummary: personaSummary,
            newMessages,
          }),
        });
        personaSummary = object.summary;
        contextUpdate.persona_summary = personaSummary;
        contextUpdate.persona_updated_at = now.toISOString();
        // +1, not the raw pre-insert totalMessageCount: the summarizer
        // effectively saw every already-persisted message PLUS this
        // turn's user message (via pendingUserMessage above) — just not
        // yet the assistant reply, which doesn't exist yet. Recording
        // the count as of what was actually summarized keeps next
        // turn's staleness arithmetic (newTotalMessageCount -
        // personaSourceMessageCount) correct: exactly 1 next time (this
        // turn's assistant row), not 2.
        contextUpdate.persona_source_message_count = totalMessageCount + 1;
        contextChanged = true;
      } catch (err) {
        // Fresher memory is a bonus, a working reply is not — fall back
        // to the existing (possibly stale, possibly empty) summary.
        console.error('[companion/message] persona summarization failed:', err);
      }
    }

    // ─── Recent-interaction recompute (fast tier) ───────────────────────
    if (
      isRecentInteractionStale({ context, currentConversationId: conversationId }) &&
      lastMessage &&
      lastMessage.conversationId !== conversationId
    ) {
      try {
        const { data: endedRows } = await supabase
          .from('companion_messages')
          .select('*')
          .eq('user_id', user.id)
          .eq('conversation_id', lastMessage.conversationId)
          .order('created_at', { ascending: true });
        const sessionMessages = ((endedRows ?? []) as MessageRow[]).map(rowToMessage);
        const { object } = await generateObject({
          model: openai('gpt-4o-mini'),
          schema: contextSummaryResultSchema,
          system: buildContextSummarizationSystemPrompt('recent_interaction'),
          prompt: buildRecentInteractionSummarizationUserPrompt({
            priorRecentInteractionSummary: recentInteractionSummary,
            sessionMessages,
          }),
        });
        recentInteractionSummary = object.summary;
        contextUpdate.recent_interaction_summary = recentInteractionSummary;
        contextUpdate.recent_interaction_updated_at = now.toISOString();
        contextUpdate.recent_interaction_conversation_id = conversationId;
        contextChanged = true;
      } catch (err) {
        console.error('[companion/message] recent-interaction summarization failed:', err);
      }
    }

    if (contextChanged) {
      const { error } = await supabase
        .from('companion_context')
        .upsert({ user_id: user.id, ...contextUpdate }, { onConflict: 'user_id' });
      if (error) {
        console.error('[companion/message] failed to persist context update:', error);
      }
    }

    // ─── Reply generation — the one call that actually speaks as Kenji ──
    const { object: replyObject } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: replyResultSchema,
      system: buildReplySystemPrompt(personalityRead),
      prompt: buildReplyUserPrompt({
        personaSummary,
        recentInteractionSummary,
        weeklySignalsText: formatWeeklySignals(weeklySummary),
        goals: weeklySummary?.goals ?? [],
        conversationTurns,
        userMessage: message,
      }),
    });

    const { error: insertError } = await supabase.from('companion_messages').insert([
      {
        id: crypto.randomUUID(),
        user_id: user.id,
        conversation_id: conversationId,
        role: 'user',
        content: message,
        crisis_flag: false,
      },
      {
        id: crypto.randomUUID(),
        user_id: user.id,
        conversation_id: conversationId,
        role: 'assistant',
        content: replyObject.reply,
        crisis_flag: false,
      },
    ]);
    if (insertError) {
      console.error('[companion/message] failed to persist exchange:', insertError);
      return NextResponse.json({ error: 'Could not save message' }, { status: 502 });
    }

    return NextResponse.json({ reply: replyObject.reply, conversationId, crisis: false });
  } catch (err) {
    // Unlike /api/insights/weekly's silent degrade, a companion reply
    // IS the point of the request — surface a real error the UI must
    // show, rather than pretending nothing happened.
    console.error('[companion/message] failed:', err);
    return NextResponse.json({ error: 'Kenji had trouble responding — try again' }, { status: 502 });
  }
}
