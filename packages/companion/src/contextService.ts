import type { CompanionContext, CompanionMessage } from './types';

// Pure, DB-agnostic staleness + session logic. No Supabase client here —
// the route (app/api/companion/message/route.ts) does the actual reads/
// writes; this module only decides WHEN a recompute is warranted. Event-
// triggered, not scheduled: this repo has no cron/scheduled-job
// infrastructure, so both tiers are checked inline on every companion
// route invocation, the same lazy-staleness philosophy
// lib/useWeeklyInsight.ts already uses locally (FRESHNESS_MS).

export const PERSONA_STALE_DAYS = 14;
export const PERSONA_STALE_MESSAGE_COUNT = 20;
export const SESSION_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours

// A new conversationId marks a new "session" — minted after a gap of
// SESSION_GAP_MS since the user's own last message. Grouping by gap
// rather than a fixed count means an active back-and-forth stays one
// conversation no matter how many turns it takes.
export function determineConversationId(args: {
  lastMessage: CompanionMessage | null;
  now: Date;
}): string {
  const { lastMessage, now } = args;
  if (!lastMessage) return crypto.randomUUID();
  const gapMs = now.getTime() - new Date(lastMessage.createdAt).getTime();
  if (gapMs > SESSION_GAP_MS) return crypto.randomUUID();
  return lastMessage.conversationId;
}

// Persona is the slow tier — recomputed rarely, only when genuinely
// stale by either measure. Never re-fed the entire history: the whole
// point of a running summary is that everything before it is already
// compressed (see contextPrompt.ts's persona prompt, which takes the
// PRIOR summary plus only the messages since personaSourceMessageCount).
export function isPersonaStale(args: {
  context: CompanionContext | null;
  totalMessageCount: number;
  now: Date;
}): boolean {
  const { context, totalMessageCount, now } = args;
  if (!context || !context.personaUpdatedAt) return true;
  const ageMs = now.getTime() - new Date(context.personaUpdatedAt).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays > PERSONA_STALE_DAYS) return true;
  const newMessages = totalMessageCount - context.personaSourceMessageCount;
  return newMessages >= PERSONA_STALE_MESSAGE_COUNT;
}

// Recent-interaction is the fast tier — recomputed once per session
// boundary. A mismatch between the digest's own recorded conversationId
// and the CURRENT one means a new session has started since it was last
// written, so the digest reflects an ended session, not the live one.
export function isRecentInteractionStale(args: {
  context: CompanionContext | null;
  currentConversationId: string;
}): boolean {
  const { context, currentConversationId } = args;
  if (!context || !context.recentInteractionConversationId) return true;
  return context.recentInteractionConversationId !== currentConversationId;
}
