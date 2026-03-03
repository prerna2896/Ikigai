'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Settings } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';

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
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16"
      data-testid="onboarding-tone"
    >
      <section className="rounded-2xl border border-slate-200 bg-surface p-8 shadow-sm">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Tone
            </p>
            <button
              type="button"
              className="text-xs text-mutedText hover:text-text"
              onClick={() => router.replace('/')}
              data-testid="onboarding-home"
            >
              Home
            </button>
          </div>
          <h1 className="text-3xl font-semibold text-text">
            How would you like this to feel?
          </h1>
          <p className="text-sm text-mutedText">
            There’s no right choice. This just helps set the tone.
          </p>
          <div className="flex flex-col gap-3" data-testid="onboarding-tone-options">
            {toneOptions.map((option) => (
              <label
                key={option.label}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text"
              >
                <input
                  type="radio"
                  name="preferred-tone"
                  value={option.label}
                  checked={preferredTone === option.value}
                  onChange={() => setPreferredTone(option.value)}
                  data-testid={`tone-option-${option.value ?? 'unsure'}`}
                />
                {option.label}
              </label>
            ))}
          </div>
          {status ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {status}
            </div>
          ) : null}
          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm text-text"
              onClick={() => router.replace('/onboarding/context')}
              data-testid="onboarding-back"
            >
              Back
            </button>
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-accent px-5 py-2 text-sm font-medium text-white"
              onClick={() => void handleContinue()}
              disabled={!repository}
              data-testid="onboarding-next"
            >
              Continue
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
