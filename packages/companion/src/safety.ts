// Deterministic (never LLM-judged) safety gate for the companion.
// Runs BEFORE any DB read and BEFORE any model call — see
// app/api/companion/message/route.ts's order of operations. This is
// the same "don't trust the model to self-police the highest-stakes
// decision" principle @ikigai/insights' signals.ts already applies to
// "should this insight fire," taken further: a false negative here is
// a much worse failure than a false positive, so patterns favor recall
// over precision (per docs/specs/ai-companion.md's explicit stance).
//
// IMPORTANT: the pattern list and the exact response copy below are a
// complete, sensible v1 draft — NOT final. Both need a mental-health-
// literate review pass before any real user, including internal
// testers, sees them. This is not an engineering call to finalize
// unilaterally.

export type CrisisCategory = 'suicidal_ideation' | 'self_harm' | 'immediate_danger';

export type CrisisCheckResult = {
  matched: boolean;
  category?: CrisisCategory;
};

type CrisisPattern = {
  pattern: RegExp;
  category: CrisisCategory;
};

// Flat and hand-auditable on purpose — a reviewer should be able to
// read top to bottom and understand every trigger without touching
// route code. Case-insensitive, tolerant of punctuation/spacing via \s*
// between words rather than literal phrase matching.
const CRISIS_PATTERNS: CrisisPattern[] = [
  // ─── Suicidal ideation ──────────────────────────────────────────────
  { pattern: /\bwant(?:ed|s)?\s+to\s+die\b/i, category: 'suicidal_ideation' },
  { pattern: /\bkill(?:ing)?\s+myself\b/i, category: 'suicidal_ideation' },
  { pattern: /\bend(?:ing)?\s+my\s+life\b/i, category: 'suicidal_ideation' },
  { pattern: /\bsuicidal?\b/i, category: 'suicidal_ideation' },
  { pattern: /\bno\s+reason\s+to\s+(live|go\s+on|keep\s+going)\b/i, category: 'suicidal_ideation' },
  { pattern: /\bbetter\s+off\s+dead\b/i, category: 'suicidal_ideation' },
  { pattern: /\bdon'?t\s+want\s+to\s+(be\s+alive|exist|wake\s+up)\b/i, category: 'suicidal_ideation' },
  { pattern: /\bcan'?t\s+go\s+on\s+(living|like\s+this)\b/i, category: 'suicidal_ideation' },

  // ─── Self-harm ──────────────────────────────────────────────────────
  { pattern: /\bhurt(?:ing)?\s+myself\b/i, category: 'self_harm' },
  { pattern: /\bcutt(?:ing)?\s+myself\b/i, category: 'self_harm' },
  { pattern: /\bself[\s-]?harm(?:ing)?\b/i, category: 'self_harm' },
  { pattern: /\bharming\s+myself\b/i, category: 'self_harm' },

  // ─── Immediate danger / plan language ───────────────────────────────
  { pattern: /\bhave\s+a\s+plan\s+to\s+(kill|hurt|end)\b/i, category: 'immediate_danger' },
  // NOTE (found via exhaustive testing — see safety.test.ts's "pattern-
  // order finding" describe block): this pattern is currently
  // unreachable in isolation. Any message matching it necessarily also
  // contains "kill myself", which matches the earlier suicidal_ideation
  // pattern above first (first match wins — see checkForCrisisLanguage).
  // matched: true is still correctly returned either way, so there is
  // no safety impact today; category would just read suicidal_ideation
  // instead of immediate_danger for this specific phrase. Left as-is
  // rather than reordered, since category isn't currently branched on
  // anywhere — flagging for whoever does the mental-health review pass.
  { pattern: /\bgoing\s+to\s+kill\s+myself\b/i, category: 'immediate_danger' },
  { pattern: /\btonight\s+i'?m\s+going\s+to\s+(end|do)\s+it\b/i, category: 'immediate_danger' },
  { pattern: /\bpills?\s+to\s+(end|take\s+my\s+life)\b/i, category: 'immediate_danger' },
];

export function checkForCrisisLanguage(message: string): CrisisCheckResult {
  const normalized = message.toLowerCase();
  for (const { pattern, category } of CRISIS_PATTERNS) {
    if (pattern.test(normalized)) {
      return { matched: true, category };
    }
  }
  return { matched: false };
}

// Fixed, verbatim, never passed through generateObject or any model
// call in any form — this exact string is what's persisted and
// returned on a crisis match.
export const CRISIS_RESOURCE_RESPONSE =
  "I hear you, and I'm glad you told me. This is bigger than what I'm able to help with, though — here's who can: " +
  'call or text 988 (Suicide & Crisis Lifeline, available 24/7 in the US), or text HOME to 741741 (Crisis Text Line). ' +
  "Outside the US, findahelpline.com can point you to a local option. I'm a planning companion, not equipped for this moment — please reach out to one of these.";

// Shown once, before first use of the companion.
export const COMPANION_DISCLOSURE_TEXT =
  "Before we talk: I'm Kenji, an AI — not a person, and not a therapist. " +
  "I can reflect on your week, your goals, and patterns you've shared with me, but I can't diagnose, treat, or replace real support. " +
  "If you're ever in crisis, please reach out to a real crisis line (988 in the US, or findahelpline.com elsewhere) rather than to me.";
