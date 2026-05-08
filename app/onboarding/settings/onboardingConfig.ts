export type SettingsStepId =
  | 'commitments'
  | 'daily_baselines'
  | 'weekly_structure'
  | 'weekly_capacity';

export type SettingsStepConfig = {
  id: SettingsStepId;
  title: string;
  helper?: string;
};

export const settingsSteps: SettingsStepConfig[] = [
  {
    id: 'commitments',
    title: 'A few fixed commitments',
    helper: 'This helps us estimate what’s realistically available.',
  },
  {
    id: 'daily_baselines',
    title: 'Some time is already spoken for',
    helper: "These aren't goals. They're just reality.",
  },
  {
    id: 'weekly_structure',
    title: 'How structured should planning feel?',
    helper: 'We’ll keep some buffer aside based on this.',
  },
  {
    id: 'weekly_capacity',
    title: 'How full do you want your week to feel?',
    helper: 'A planning preference — a guess is enough.',
  },
];
