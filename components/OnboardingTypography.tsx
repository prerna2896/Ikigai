'use client';

import { ReactNode } from 'react';

interface OnboardingH1Props {
  children: ReactNode;
  className?: string;
}

interface OnboardingBodyProps {
  children: ReactNode;
  className?: string;
}

interface OnboardingLabelProps {
  children: ReactNode;
  className?: string;
}

export function OnboardingH1({ children, className = '' }: OnboardingH1Props) {
  return (
    <h1 className={`font-serif text-xl md:text-2xl lg:text-3xl font-semibold text-text ${className}`}>
      {children}
    </h1>
  );
}

export function OnboardingBody({ children, className = '' }: OnboardingBodyProps) {
  return (
    <p className={`text-sm md:text-base text-mutedText ${className}`}>
      {children}
    </p>
  );
}

export function OnboardingLabel({ children, className = '' }: OnboardingLabelProps) {
  return (
    <label className={`text-sm md:text-base text-mutedText ${className}`}>
      {children}
    </label>
  );
}