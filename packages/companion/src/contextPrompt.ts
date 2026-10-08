import { z } from 'zod';
import type { CompanionMessage } from './types';

// Prompts for the context-summarization calls — separate from the
// Kenji-voice reply call in replyPrompt.ts. These run first (when
// stale) and their output feeds the reply call as plain text input.
// Deliberately plain, non-character prompts (not "Kenji" voiced) —
// this is a compression/extraction task, not a conversation turn.

export const contextSummaryResultSchema = z.object({
  summary: z.string().min(1).max(600),
});

export function buildContextSummarizationSystemPrompt(
  tier: 'persona' | 'recent_interaction',
): string {
  if (tier === 'persona') {
    return `You maintain a running, private summary of who a person is, for an AI planning companion to reference in future conversations. This summary is never shown to the person directly.

Capture: what they seem to care about, recurring patterns in how they work/rest/relate to their goals, what kind of tone or support they respond well to. Do NOT capture: specific dates, one-off events without a pattern, anything that reads as a diagnosis or clinical judgment.

You'll be given the EXISTING summary (which may be empty, for a first-time summary) plus new material to fold in. Produce an UPDATED summary that incorporates anything genuinely new or that revises the existing picture — don't just append, actually integrate. Keep it compact: a few sentences, not a list. If nothing in the new material changes the picture, it's fine to return the existing summary unchanged.`;
  }
  return `You maintain a short, private digest of a person's most recent conversation with an AI planning companion, for that companion to reference on their NEXT visit. Never shown to the person directly.

Capture: what was actually discussed, anything they said they'd try or were working through, the tone of how the conversation ended. Do NOT capture: word-for-word transcript, anything not actually said.

You'll be given the prior digest (if any) and the full set of messages from the session that just ended. Produce a compact digest — a few sentences — that would let the companion pick the thread back up naturally next time.`;
}

function formatMessages(messages: CompanionMessage[]): string {
  return messages.map((m) => `- [${m.role}] ${m.content}`).join('\n');
}

export function buildPersonaSummarizationUserPrompt(args: {
  priorPersonaSummary: string;
  newMessages: CompanionMessage[];
}): string {
  const { priorPersonaSummary, newMessages } = args;
  return `## Existing summary
${priorPersonaSummary.trim() || '(none yet — this is the first summary)'}

## New material to fold in
${formatMessages(newMessages) || '(none)'}

Produce the updated summary.`;
}

export function buildRecentInteractionSummarizationUserPrompt(args: {
  priorRecentInteractionSummary: string;
  sessionMessages: CompanionMessage[];
}): string {
  const { priorRecentInteractionSummary, sessionMessages } = args;
  return `## Prior digest
${priorRecentInteractionSummary.trim() || '(none yet)'}

## The session that just ended
${formatMessages(sessionMessages) || '(none)'}

Produce the updated digest.`;
}
