'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Profile } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';

export default function OnboardingContextPage() {
  const router = useRouter();
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      Promise.all([repo.getProfile(), repo.getSettings()])
        .then(([profileRecord]) => {
          if (!profileRecord) {
            setProfile(null);
            return;
          }
          setProfile(profileRecord);
          const trimmedName = profileRecord.name?.trim();
          const firstName = trimmedName ? trimmedName.split(/\s+/)[0] : '';
          setProfileName(firstName || null);
          setNameInput(trimmedName || '');
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, [router]);

  return (
    <main
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16"
      data-testid="onboarding-context"
    >
      <section className="rounded-2xl border border-slate-200 bg-surface p-8 shadow-sm">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              A quick pause
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
            {profileName
              ? `${profileName}, a calm place to plan and recalibrate.`
              : 'A calm place to plan and recalibrate.'}
          </h1>
          {!profile ? (
            <label className="flex flex-col gap-2 text-sm text-mutedText">
              What should we call you?
              <input
                type="text"
                className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder="Your name"
                data-testid="onboarding-name-input"
              />
            </label>
          ) : null}
          <div className="space-y-3 text-sm text-mutedText">
            <p>
              This isn’t about doing more, or getting everything right. It’s
              about noticing how your time and energy are actually going — and
              adjusting without self-judgment.
            </p>
            <p>
              Some weeks flow. Some don’t. Looking back clearly — and kindly — is
              often enough to recalibrate.
            </p>
            <p className="text-xs text-mutedText">
              You don’t need perfect answers here. Honest ones are enough.
            </p>
          </div>
          <blockquote className="rounded-xl border border-slate-200 bg-accentSoft px-4 py-3 text-sm italic text-text">
            “Clarity comes from looking, not from forcing.”
          </blockquote>
          {status ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {status}
            </div>
          ) : null}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-accent px-5 py-2 text-sm font-medium text-white"
              onClick={async () => {
                if (!repository) {
                  return;
                }
                const trimmed = nameInput.trim();
                if (!profile && !trimmed) {
                  setStatus('Please enter a name to continue.');
                  return;
                }
                if (!profile && trimmed) {
                  const nowIso = new Date().toISOString();
                  await repository.saveProfile({
                    id: crypto.randomUUID(),
                    name: trimmed,
                    reflections: [],
                    createdAt: nowIso,
                    updatedAt: nowIso,
                  });
                }
                router.replace('/onboarding/tone');
              }}
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
