'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Profile } from '@ikigai/core';
import { OnboardingProgress } from '../../../components/OnboardingProgress';
import OnboardingMonk from '../../../components/OnboardingMonk';
import { OnboardingH1, OnboardingBody, OnboardingLabel } from '../../../components/OnboardingTypography';
import { useRepository } from '../../../components/RepositoryProvider';

export default function OnboardingContextPage() {
  const router = useRouter();
  const { profileRepo, settingsRepo } = useRepository();
  const [status, setStatus] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (!profileRepo || !settingsRepo) return;
    let cancelled = false;
    Promise.all([profileRepo.getProfile(), settingsRepo.getSettings()])
      .then(([profileRecord]) => {
        if (cancelled) return;
        if (!profileRecord) {
          setProfile(null);
          return;
        }
        // Guard: already-onboarded users landing here (stale bookmark,
        // stale login "next" param, fresh sign-in where cloud already
        // has their profile) skip straight to /. Editing your name
        // later lives on /profile.
        const trimmedName = profileRecord.name?.trim();
        if (trimmedName) {
          router.replace('/');
          return;
        }
        setProfile(profileRecord);
        const firstName = trimmedName ? trimmedName.split(/\s+/)[0] : '';
        setProfileName(firstName || null);
        setNameInput(trimmedName || '');
      })
      .catch((error) => {
        if (!cancelled) setStatus(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [router, profileRepo, settingsRepo]);


  return (
    <main
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-3 px-4 pb-4 pt-8"
      data-testid="onboarding-context"
    >
      <OnboardingProgress step={1} total={5} label="Context" />

      <section className="rounded-xl border border-slate-200 bg-surface p-4 shadow-sm max-w-2xl mx-auto">
        <div className="space-y-3">
          <OnboardingH1>
            {profileName
              ? `${profileName}, a calm place to plan and recalibrate.`
              : 'A calm place to plan and recalibrate.'}
          </OnboardingH1>
          {!profile ? (
            <OnboardingLabel className="flex flex-col gap-2">
              What should we call you?
              <input
                type="text"
                className="rounded-xl border border-slate-200 px-4 py-3 text-text text-base min-h-12"
                value={nameInput}
                onChange={(event) => {
                  setNameInput(event.target.value);
                  // Clear error when user starts typing
                  if (status && event.target.value.trim()) {
                    setStatus(null);
                  }
                  // Trigger typing state
                  setIsTyping(true);
                  // Clear typing state after a short delay
                  setTimeout(() => setIsTyping(false), 1000);
                }}
                placeholder="Your name"
                data-testid="onboarding-name-input"
              />
            </OnboardingLabel>
          ) : null}
          <div className="space-y-3">
            <OnboardingBody>
              This isn&apos;t about doing more, or getting everything right. It&apos;s
              about noticing how your time and energy are actually going — and
              adjusting without self-judgment.
            </OnboardingBody>
          </div>
          <blockquote className="rounded-xl border border-slate-200 bg-accentSoft px-4 py-3">
            <OnboardingBody className="italic">
              &ldquo;Happiness is peace in motion and peace is happiness at rest.&rdquo;
            </OnboardingBody>
          </blockquote>
          {status ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <OnboardingBody className="text-rose-700">{status}</OnboardingBody>
            </div>
          ) : null}

          {/* Kenji and Continue Button */}
          <div className="flex flex-col items-center gap-4 pt-4">
            {/* Kenji Guide - centered */}
            <div className="flex justify-center items-center">
              <OnboardingMonk
                step="context"
                size={80}
                message="Hi, I'm Kenji — honored to be a part of your journey."
                isTyping={isTyping}
              />
            </div>

            {/* Continue button */}
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-accent px-6 py-3 text-sm font-medium text-white min-h-12"
              onClick={async () => {
                if (!profileRepo) {
                  return;
                }
                const trimmed = nameInput.trim();
                if (!profile && !trimmed) {
                  setStatus('Please enter a name to continue.');
                  return;
                }

                if (!profile && trimmed) {
                  const nowIso = new Date().toISOString();
                  await profileRepo.saveProfile({
                    id: crypto.randomUUID(),
                    name: trimmed,
                    reflections: [],
                    createdAt: nowIso,
                    updatedAt: nowIso,
                  });
                }
                router.replace('/onboarding/tone');
              }}
              disabled={!profileRepo}
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