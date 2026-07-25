export type ReflectionQuestion = {
  id: string;
  prompt: string;
  helper?: string;
  type: 'text' | 'choice';
  options?: string[];
  hasOther?: boolean;
};

export const OTHER_SENTINEL = '__other__';

export const reflectionQuestions: ReflectionQuestion[] = [
  {
    id: 'wins-to-notice',
    prompt: 'When a week feels good, what do you want to notice about it?',
    type: 'choice',
    options: [
      'I made progress on something that matters',
      'I felt present and not scattered',
      'I had energy left at the end of the day',
      'I spent time on things I care about',
      'I felt balanced across different areas of life',
    ],
    hasOther: true,
  },
  {
    id: 'steady-goal',
    prompt: 'What do you want to move toward this season?',
    type: 'choice',
    options: [
      'More balance across work and life',
      'Building a consistent routine',
      'Making progress on a personal project',
      'Improving my health or energy',
      'Growing in my career or skills',
      'Creating more space for rest',
    ],
    hasOther: true,
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
