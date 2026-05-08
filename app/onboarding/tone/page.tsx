'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Settings } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import { OnboardingProgress } from '../../../components/OnboardingProgress';

const toneOptions: Array<{
  label: string;
  value: Settings['preferredTone'];
}> = [
  { label: 'Calm and spacious', value: 'calm_spacious' },
  { label: 'Structured and grounding', value: 'structured_grounding' },
  { label: 'Light and exploratory', value: 'light_exploratory' },
  { label: "I'm not sure yet", value: null },
];

export default function OnboardingTonePage() {
  const router = useRouter();
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [preferredTone, setPreferredTone] = useState<Settings['preferredTone']>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      Promise.all([repo.getProfile(), repo.getSettings()])
        .then(([profile, settings]) => {
          if (!profile) {
            router.replace('/onboarding/context');
            return;
          }
          setPreferredTone(settings.preferredTone ?? null);
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, [router]);

  const handleContinue = async () => {
    if (!repository) {
      return;
    }
    const settings = await repository.getSettings();
    const nowIso = new Date().toISOString();
    await repository.saveSettings({
      ...settings,
      preferredTone,
      updatedAt: nowIso,
    });
    router.replace('/onboarding/reflection');
  };

  return (
    <main
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 pb-12 pt-12"
      data-testid="onboarding-tone"
    >
      <OnboardingProgress step={2} total={5} label="Style" />
      <header className="space-y-3">
        <h1 className="font-serif text-3xl font-semibold text-text">
          How would you like this to feel?
        </h1>
        <p className="text-sm text-mutedText">
          There’s no right choice. This just helps set the tone.
        </p>
      </header>
      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        data-testid="onboarding-tone-options"
      >
        {toneOptions.map((option) => {
          const selected = preferredTone === option.value;
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => setPreferredTone(option.value)}
              data-testid={`tone-option-${option.value ?? 'unsure'}`}
              aria-pressed={selected}
              className={`min-h-12 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                selected
                  ? 'border-accent bg-accent text-white shadow-sm'
                  : 'border-slate-200 bg-white text-text hover:border-slate-300'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </section>
      {status ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {status}
        </div>
      ) : null}
      <footer className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-full border border-slate-300 px-4 py-2 text-sm text-text"
          onClick={() => router.replace('/onboarding/context')}
          data-testid="onboarding-back"
        >
          ← Back
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white"
          onClick={() => void handleContinue()}
          disabled={!repository}
          data-testid="onboarding-next"
        >
          Continue <span aria-hidden>→</span>
        </button>
      </footer>
    </main>
  );
}
