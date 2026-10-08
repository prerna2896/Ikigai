import type { PersonalityRead } from './traits';

// Named personality segments — human-readable labels over the six valid
// (structureTolerance × highEmotionalSensitivity) combinations that
// derivePersonalityRead can actually produce (coachingStyle is derived,
// not independently chosen — see traits.ts). Not a separate
// classification system: every segment here is a real PersonalityRead a
// real user could land on from their reflection answers.
//
// Used by the insights playground (app/dev/insights-playground) so
// testing "does this read differently for different people" doesn't
// require hand-writing personalityRead JSON. Kept in @ikigai/insights
// rather than the playground page so it can also back a future
// user-facing "your reflection style" surface without duplicating the
// segment definitions.

export type PersonalitySegment = {
  id: string;
  label: string;
  description: string;
  personalityRead: PersonalityRead;
};

export const PERSONALITY_SEGMENTS: PersonalitySegment[] = [
  {
    id: 'steady-direct',
    label: 'Steady & Direct',
    description:
      'Open to bigger changes, not sensitive to pressure — wants plain, specific observations.',
    personalityRead: {
      structureTolerance: 'structure_tolerant',
      highEmotionalSensitivity: false,
      coachingStyle: 'direct_data_forward',
    },
  },
  {
    id: 'gentle-reflective',
    label: 'Gentle & Reflective',
    description:
      'Prefers small, gentle shifts and needs a quiet reset when plans slip — wants validation, not correction.',
    personalityRead: {
      structureTolerance: 'gentle_pacing',
      highEmotionalSensitivity: true,
      coachingStyle: 'validation_forward',
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'No strong signal either way — the default, plain-and-warm voice.',
    personalityRead: {
      structureTolerance: 'balanced',
      highEmotionalSensitivity: false,
      coachingStyle: 'balanced',
    },
  },
  {
    id: 'open-but-sensitive',
    label: 'Open to Change, but Sensitive',
    description:
      'Comfortable with bigger changes, but sensitivity to pressure overrides that — still gets the gentle voice.',
    personalityRead: {
      structureTolerance: 'structure_tolerant',
      highEmotionalSensitivity: true,
      coachingStyle: 'validation_forward',
    },
  },
  {
    id: 'cautious-starter',
    label: 'Cautious Starter',
    description:
      'Prefers gentle pacing but not flagged as pressure-sensitive — gets the plain, balanced voice rather than validation-forward.',
    personalityRead: {
      structureTolerance: 'gentle_pacing',
      highEmotionalSensitivity: false,
      coachingStyle: 'balanced',
    },
  },
];
