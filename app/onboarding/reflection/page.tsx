'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Profile } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import { reflectionQuestions } from './questions';

export default function OnboardingReflectionPage() {
  const router = useRouter();
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      Promise.all([repo.getProfile(), repo.getSettings()])
        .then(([profileRecord]) => {
          if (!profileRecord) {
            router.replace('/onboarding/name');
            return;
          }
          setProfile(profileRecord);
          const existingAnswers = profileRecord.reflections.reduce(
            (acc, reflection) => {
              acc[reflection.questionId] = reflection.answer;
              return acc;
            },
            {} as Record<string, string>,
          );
          setAnswers(existingAnswers);
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, [router]);

  const handleAnswerChange = (questionId: string, answer: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answer,
    }));
  };

  const handleContinue = async () => {
    if (!repository || !profile) {
      return;
    }
    const nowIso = new Date().toISOString();
    const reflections = reflectionQuestions.map((question) => ({
      questionId: question.id,
      answer: answers[question.id] ?? '',
    }));
    const updatedProfile: Profile = {
      ...profile,
      reflections,
      updatedAt: nowIso,
    };
    await repository.saveProfile(updatedProfile);
    router.replace('/onboarding/settings');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Reflection
        </p>
        <h1 className="text-3xl font-semibold text-text">
          A few gentle questions
        </h1>
        <p className="text-sm text-mutedText">
          There are no right answers here. Short responses are enough.
        </p>
        {status ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {status}
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-6">
          {reflectionQuestions.map((question) => (
            <div key={question.id} className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text">
                {question.prompt}
              </label>
              {question.helper ? (
                <p className="text-xs text-mutedText">{question.helper}</p>
              ) : null}
              {question.type === 'text' ? (
                <textarea
                  className="min-h-[80px] rounded-xl border border-slate-200 px-3 py-2 text-sm text-text"
                  value={answers[question.id] ?? ''}
                  onChange={(event) =>
                    handleAnswerChange(question.id, event.target.value)
                  }
                  placeholder="A short note is fine"
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {question.options?.map((option) => (
                    <label
                      key={option}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-text"
                    >
                      <input
                        type="radio"
                        name={question.id}
                        value={option}
                        checked={answers[question.id] === option}
                        onChange={() => handleAnswerChange(question.id, option)}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-full border border-slate-300 px-4 py-2 text-text"
          onClick={() => router.replace('/onboarding/name')}
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-full bg-accent px-5 py-2 font-medium text-white"
          onClick={() => void handleContinue()}
          disabled={!repository || !profile}
        >
          Continue
        </button>
      </footer>
    </main>
  );
}
