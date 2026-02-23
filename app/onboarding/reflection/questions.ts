export type ReflectionQuestion = {
  id: string;
  prompt: string;
  helper?: string;
  type: 'text' | 'choice';
  options?: string[];
};

export const reflectionQuestions: ReflectionQuestion[] = [
  {
    id: 'wins-to-notice',
    prompt: 'When a week feels good, what do you want to notice about it?',
    helper: 'Short and personal is fine.',
    type: 'text',
  },
  {
    id: 'steady-goal',
    prompt: 'What do you want to move toward this season?',
    helper: 'A direction is enough.',
    type: 'text',
  },
  {
    id: 'energy-shape',
    prompt: 'How does your energy usually feel across a week?',
    type: 'choice',
    options: [
      'Steady most days',
      'Peaks and dips',
      'Slow to start, stronger later',
      'Varies a lot',
      'Not sure yet',
    ],
  },
  {
    id: 'planning-pace',
    prompt: 'What pace of change feels supportive right now?',
    type: 'choice',
    options: [
      'Small, gentle shifts',
      'One or two meaningful changes',
      'Open to bigger changes',
      'Not sure yet',
    ],
  },
  {
    id: 'self-compassion',
    prompt: 'When plans shift, what helps you stay kind to yourself?',
    type: 'choice',
    options: [
      'A quiet reset',
      'Talking it out',
      'Rewriting the plan',
      'Stepping away for a bit',
      'Not sure yet',
    ],
  },
];
