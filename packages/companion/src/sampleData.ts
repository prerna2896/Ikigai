import type { CompanionContext, CompanionMessage } from './types';

// Sample data for the companion package's own inputs — the two-tier
// context store and message history — mirroring @ikigai/insights'
// sampleData.ts. Covers what contextService.ts's staleness/session
// logic needs: a context row in every relevant state, and messages at
// various ages for session-boundary testing.

function message(overrides: Partial<CompanionMessage> & { id: string; content: string }): CompanionMessage {
  return {
    userId: 'user-1',
    conversationId: 'conv-1',
    role: 'user',
    crisisFlag: false,
    createdAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

export const SAMPLE_MESSAGES = {
  recentUserMessage: message({ id: 'm1', content: 'hey, how do I feel about this week?', createdAt: '2026-09-20T10:00:00.000Z' }),
  oldUserMessage: message({ id: 'm2', content: 'checking in from a while ago', createdAt: '2026-09-01T10:00:00.000Z' }),
};

function context(overrides: Partial<CompanionContext> = {}): CompanionContext {
  return {
    userId: 'user-1',
    personaSummary: '',
    personaUpdatedAt: null,
    personaSourceMessageCount: 0,
    recentInteractionSummary: '',
    recentInteractionUpdatedAt: null,
    recentInteractionConversationId: null,
    ...overrides,
  };
}

export const SAMPLE_CONTEXTS = {
  none: null,
  freshNeverBuilt: context(),
  personaRecent: context({
    personaSummary: 'Cares about creative work, tends to overcommit at work.',
    personaUpdatedAt: '2026-09-20T09:00:00.000Z',
    personaSourceMessageCount: 10,
  }),
  personaStaleByAge: context({
    personaSummary: 'Old summary.',
    personaUpdatedAt: '2026-09-01T09:00:00.000Z', // >14 days before 2026-09-20
    personaSourceMessageCount: 10,
  }),
  personaStaleByMessageCount: context({
    personaSummary: 'Old summary.',
    personaUpdatedAt: '2026-09-19T09:00:00.000Z', // recent
    personaSourceMessageCount: 5, // but 20+ new messages since
  }),
  recentInteractionMatchingConversation: context({
    recentInteractionSummary: 'Talked about work stress last time.',
    recentInteractionConversationId: 'conv-1',
  }),
  recentInteractionStaleConversation: context({
    recentInteractionSummary: 'Talked about work stress last time.',
    recentInteractionConversationId: 'conv-OLD',
  }),
};
