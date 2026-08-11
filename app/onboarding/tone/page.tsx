'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Settings, type Profile } from '@ikigai/core';
import { OnboardingProgress } from '../../../components/OnboardingProgress';
import OnboardingMonk from '../../../components/OnboardingMonk';
import { OnboardingH1, OnboardingBody } from '../../../components/OnboardingTypography';
import { useRepository } from '../../../components/RepositoryProvider';

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
  const { profileRepo, settingsRepo } = useRepository();
  const [preferredTone, setPreferredTone] = useState<Settings['preferredTone']>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!profileRepo || !settingsRepo) return;
    let cancelled = false;
    profileRepo
      .getProfile()
      .then((profileRecord) => {
        if (cancelled) return;
        if (profileRecord) setProfile(profileRecord);
      })
      .catch((error) => {
        if (!cancelled) setStatus(String(error));
      });

    settingsRepo
      .getSettings()
      .then((settings) => {
        if (!cancelled) setPreferredTone(settings.preferredTone ?? null);
      })
      .catch((error) => {
        console.error('Settings loading error:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [profileRepo, settingsRepo]);

  const handleContinue = async () => {
    if (!settingsRepo) return;
    const settings = await settingsRepo.getSettings();
    const nowIso = new Date().toISOString();
    await settingsRepo.saveSettings({
      ...settings,
      preferredTone,
      updatedAt: nowIso,
    });
    router.replace('/onboarding/reflection');
  };

  const firstName = profile?.name.trim().split(' ')[0] || 'there';

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pt-8">
      <main
        className="w-full max-w-4xl mx-auto"
        data-testid="onboarding-tone"
      >
        {/* Progress */}
        <div className="mb-6">
          <OnboardingProgress step={2} total={5} label="Style" />
        </div>

        {/* Main Content Area */}
        <div className="space-y-6 max-w-2xl mx-auto">
          <header className="text-center space-y-2">
            <OnboardingH1>How would you like your days to feel?</OnboardingH1>
          </header>

          <section
            className="space-y-3"
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
                  className={`w-full min-h-12 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
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

          {status && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <OnboardingBody className="text-rose-700">{status}</OnboardingBody>
            </div>
          )}

          {/* Inline Kenji */}
          <div className="flex justify-center pt-4">
            <OnboardingMonk
              step="tone"
              size={100}
              
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between">
          <button
            type="button"
            className="rounded-full border border-slate-300 px-6 py-3 min-h-12 text-sm text-text hover:bg-slate-50 transition-colors"
            onClick={() => router.replace('/onboarding/context')}
            data-testid="onboarding-back"
          >
            ← Back
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 min-h-12 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
            onClick={() => void handleContinue()}
            disabled={!settingsRepo}
            data-testid="onboarding-next"
          >
            Continue <span aria-hidden>→</span>
          </button>
        </footer>
      </main>
    </div>
  );
}