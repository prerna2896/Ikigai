'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_SETTINGS_TIMESTAMP, type Profile } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';

export default function OnboardingNamePage() {
  const router = useRouter();
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      Promise.all([repo.getProfile(), repo.getSettings()])
        .then(([profile]) => {
          if (profile) {
            router.replace('/onboarding/context');
          }
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
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setStatus('Please enter a name to continue.');
      return;
    }
    const nowIso = new Date().toISOString();
    const profile: Profile = {
      id: crypto.randomUUID(),
      name: trimmed,
      reflections: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await repository.saveProfile(profile);
    router.replace('/onboarding/context');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Welcome
        </p>
        <h1 className="text-3xl font-semibold text-text">
          Glad you’re here.
        </h1>
        <p className="text-sm text-mutedText">
          We’ll keep things gentle and simple. A few small choices now will help
          this space feel like yours.
        </p>
        {status ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {status}
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <label className="flex flex-col gap-2 text-sm text-mutedText">
          What should we call you?
          <input
            type="text"
            id="onboarding-name"
            name="onboardingName"
            className="rounded-xl border border-slate-200 px-3 py-2 text-text"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            placeholder="Your name"
          />
        </label>
      </section>

      <footer className="flex items-center justify-end">
        <button
          type="button"
          aria-label="Continue"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white"
          onClick={() => void handleContinue()}
          disabled={!repository}
        >
          <span aria-hidden="true">→</span>
        </button>
      </footer>
    </main>
  );
}
