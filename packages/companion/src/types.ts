// Companion-specific shapes. Deliberately separate from @ikigai/insights'
// WeeklySignal/WeeklyMetricsSummary types (imported, not redefined) —
// this package is the stateful, safety-critical half of Kenji; keeping
// its own types here (rather than folding into @ikigai/insights) mirrors
// the package split itself.

export type CompanionRole = 'user' | 'assistant';

export type CompanionMessage = {
  id: string;
  userId: string;
  conversationId: string;
  role: CompanionRole;
  content: string;
  crisisFlag: boolean;
  createdAt: string;
};

// One row per user — both tiers of the context store (see
// contextService.ts for the staleness rules governing each).
export type CompanionContext = {
  userId: string;
  personaSummary: string;
  personaUpdatedAt: string | null;
  personaSourceMessageCount: number;
  recentInteractionSummary: string;
  recentInteractionUpdatedAt: string | null;
  recentInteractionConversationId: string | null;
};
