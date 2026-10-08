import type { ProfileReflection } from '@ikigai/core';

// Heuristic personality read derived from two of the five onboarding
// reflection questions. This is NOT a validated psychometric instrument —
// the reflection questions were written as gentle onboarding prompts, not
// a Big Five inventory. Treat these as coarse proxies for "how should the
// AI Insights copy be phrased," nothing more.
//
// wins-to-notice / steady-goal / energy-shape are values-and-goals content
// (what the user cares about), not pacing/sensitivity signals, so they're
// deliberately excluded from trait derivation.

export type StructureTolerance =
  | 'gentle_pacing'
  | 'balanced'
  | 'structure_tolerant';

export type CoachingStyle =
  | 'validation_forward'
  | 'balanced'
  | 'direct_data_forward';

export type PersonalityRead = {
  structureTolerance: StructureTolerance;
  highEmotionalSensitivity: boolean;
  coachingStyle: CoachingStyle;
};

const findAnswer = (
  reflections: Pick<ProfileReflection, 'questionId' | 'answer'>[],
  questionId: string,
): string | null =>
  reflections.find((r) => r.questionId === questionId)?.answer ?? null;

const deriveStructureTolerance = (
  answer: string | null,
): StructureTolerance => {
  switch (answer) {
    case 'Small, gentle shifts':
      return 'gentle_pacing';
    case 'Open to bigger changes':
      return 'structure_tolerant';
    case 'One or two meaningful changes':
    default:
      return 'balanced';
  }
};

// Withdrawal-coded self-compassion answers ("I need to step back from
// this") read as higher sensitivity to pressure/disruption. Answers that
// suggest active problem-solving, or "not sure," default to false rather
// than presuming fragility — the coaching_style fallback is the neutral
// structure-tolerance axis, not an assumption either way.
const deriveHighEmotionalSensitivity = (answer: string | null): boolean =>
  answer === 'A quiet reset' || answer === 'Stepping away for a bit';

export function derivePersonalityRead(
  reflections: Pick<ProfileReflection, 'questionId' | 'answer'>[],
): PersonalityRead {
  const structureTolerance = deriveStructureTolerance(
    findAnswer(reflections, 'planning-pace'),
  );
  const highEmotionalSensitivity = deriveHighEmotionalSensitivity(
    findAnswer(reflections, 'self-compassion'),
  );

  // Emotional-sensitivity signal overrides the structure-tolerance axis
  // when present, matching the framing that pacing/validation concerns
  // take priority over "how direct should this be" once someone has
  // signaled they're sensitive to pressure.
  const coachingStyle: CoachingStyle = highEmotionalSensitivity
    ? 'validation_forward'
    : structureTolerance === 'structure_tolerant'
      ? 'direct_data_forward'
      : 'balanced';

  return { structureTolerance, highEmotionalSensitivity, coachingStyle };
}
