'use client';

import ModernMonk, { type MonkMood } from './ModernMonk';
import { useTheme, getMonkVariantForTheme } from '../hooks/useTheme';

type OnboardingStep = 'context' | 'name' | 'tone' | 'reflection' | 'goals' | 'settings';

type StepConfig = {
  mood: MonkMood;
  message: string;
  supportiveMessages?: string[];
};

const STEP_CONFIGS: Record<OnboardingStep, StepConfig> = {
  context: {
    mood: 'smile',
    message: "Welcome! I'm Kenji, and I'm here to help you discover your Ikigai. Let's start by understanding what brings you here.",
    supportiveMessages: [
      "Take your time. There are no wrong answers on this journey.",
      "I'm curious to learn about what drew you to explore your purpose.",
      "In my experience, the path to Ikigai begins with honest reflection."
    ]
  },
  name: {
    mood: 'calm',
    message: "Names carry energy. What should I call you on this journey?",
    supportiveMessages: [
      "I believe knowing someone's name is the first step to understanding them.",
      "How would you like me to address you as we explore together?",
      "Take your time - there's no rush to get started."
    ]
  },
  tone: {
    mood: 'calm',
    message: "There's no right choice. This just helps set the tone and identify what you're looking for.",
    supportiveMessages: [
      "Some prefer gentle guidance, others direct insight. Both paths lead to wisdom.",
      "Your comfort matters - let's find what works for you.",
      "There's no rush. We can go at your pace, step by step."
    ]
  },
  reflection: {
    mood: 'calm',
    message: "Time for some deeper reflection. These questions help us understand your inner landscape.",
    supportiveMessages: [
      "Reflection takes courage. I'm here with you as you look within.",
      "Listen to your intuition as you consider these questions.",
      "There's wisdom in pausing and honestly examining what moves you."
    ]
  },
  goals: {
    mood: 'smile',
    message: "Now let's explore what you're working toward. Goals give our days direction and meaning.",
    supportiveMessages: [
      "What lights you up when you think about the future?",
      "Goals can evolve - this is just our starting point.",
      "What matters most to you in this moment?"
    ]
  },
  settings: {
    mood: 'calm',
    message: "A few quick questions about your schedule — this helps us figure out how much time you actually have each week.",
    supportiveMessages: [
      "These small details make a big difference in your daily practice.",
      "You can always adjust these later as you discover what works.",
      "We're creating a space that supports your growth and reflection."
    ]
  }
};

type OnboardingMonkProps = {
  step: OnboardingStep;
  size?: number;
  message?: string;
  isTyping?: boolean;
  onInteraction?: () => void;
};

export default function OnboardingMonk({
  step,
  size = 240,
  message,
  isTyping = false,
  onInteraction
}: OnboardingMonkProps) {
  const theme = useTheme();
  const variant = getMonkVariantForTheme(theme);
  const config = STEP_CONFIGS[step];

  const currentMessage = message !== undefined ? message : config.message;

  return (
    <div className="flex flex-col items-center" data-testid="onboarding-monk">
      <div className="w-32 md:w-auto">
        <ModernMonk
          variant={variant}
          mood={config.mood}
          size={size}
          message={currentMessage}
          isTyping={isTyping}
          onInteraction={onInteraction}
        />
      </div>
    </div>
  );
}