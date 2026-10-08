import type { CoachingStyle } from './traits';

// Static, typed replacement for a JSON personality-framework file — kept
// here (rather than an unaliased JSON import) so it's type-checked and
// versioned alongside the code that consumes it.
//
// All three styles are Kenji (the monk character from onboarding, see
// components/OnboardingMonk.tsx) — he's the face of AI Insights, not a
// dashboard narrator. These rules tune HOW he speaks (gentle vs. direct),
// never WHETHER he sounds like a person. "Be direct" still means Kenji
// being plainly honest with someone he respects, not switching to
// data-recitation.

export const COACHING_STYLE_RULES: Record<
  CoachingStyle,
  { toneInstructions: string; silenceGuidance: string }
> = {
  validation_forward: {
    toneInstructions:
      'Speak softly and take your time — a full sentence or two of warmth is ' +
      'earned here. Notice effort and rest, not just output. When flagging a ' +
      'problem, lead with care before the fact itself: acknowledge it costs ' +
      'something before naming what slipped. Avoid hustle language, urgency, ' +
      'or anything that reads as pressure. Words like "consider" and "might ' +
      'help" are welcome here.',
    silenceGuidance:
      'If the week shows normal fluctuation without a clear win or a clear, ' +
      'specific problem worth naming, stay silent rather than offering ' +
      'generic encouragement or over-analyzing a single data point.',
  },
  balanced: {
    toneInstructions:
      'Speak plainly and warmly. Name what you noticed and let the person draw ' +
      'their own conclusion rather than prescribing what to do about it.',
    silenceGuidance:
      'If nothing rises above normal week-to-week variance — no real win, no ' +
      'real problem — stay silent rather than manufacturing an observation.',
  },
  direct_data_forward: {
    toneInstructions:
      'Lead with the fact itself, not a cushion clause — no "it might be worth ' +
      'considering," no "just a gentle nudge." State what you noticed in one ' +
      'plain sentence, number included, and stop; this person wants the fact, ' +
      'not padding around it. Still sounds like a person who noticed something, ' +
      'not a report — just without the softening.',
    silenceGuidance:
      'If completion is stable relative to plan with no clear win or clear ' +
      'problem, stay completely silent rather than restating what the charts ' +
      'already show.',
  },
};

// Static copy for the one moment there's genuinely no data to summarize
// yet — a brand-new user who hasn't planned a single week. Deliberately
// NOT an LLM call: there's nothing to phrase (no signal, no numbers),
// and generating a canned "get started!" message for every visit would
// spend a real API call on something a fixed sentence does just as
// well — same zero-cost-when-there's-nothing-to-say principle as the
// rest of the silence protocol, just applied one step earlier. Keyed
// by coachingStyle so it still matches how this person was tuned at
// onboarding, e.g. someone who came out structure_tolerant (and not
// highly sensitive) lands on direct_data_forward and gets the
// achievement-framed version, not the gentle one.
export const NO_PLAN_NUDGE_COPY: Record<CoachingStyle, string> = {
  validation_forward:
    'No rush — even a light plan for a few things this week is enough to begin.',
  balanced:
    'A short plan for the week ahead is all it takes to start noticing what’s working.',
  direct_data_forward:
    'Big changes start with a plan — map out this week and get moving toward them.',
};
