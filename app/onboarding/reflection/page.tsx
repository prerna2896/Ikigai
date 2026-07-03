'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Profile } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import { reflectionQuestions } from './questions';
import { OnboardingProgress } from '../../../components/OnboardingProgress';
import OnboardingMonk from '../../../components/OnboardingMonk';
import { OnboardingH1, OnboardingBody } from '../../../components/OnboardingTypography';

export default function OnboardingReflectionPage() {
  const router = useRouter();
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const totalQuestions = reflectionQuestions.length;
  const currentQuestion = reflectionQuestions[currentIndex];
  const isLast = currentIndex === totalQuestions - 1;

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      Promise.all([repo.getProfile(), repo.getSettings()])
        .then(([profileRecord]) => {
          if (!profileRecord) {
            router.replace('/onboarding/context');
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

  const persistAndContinue = async () => {
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

  const handleNext = () => {
    if (isLast) {
      void persistAndContinue();
      return;
    }
    setCurrentIndex((index) => Math.min(index + 1, totalQuestions - 1));
  };

  const handleBack = () => {
    if (currentIndex === 0) {
      router.replace('/onboarding/tone');
      return;
    }
    setCurrentIndex((index) => Math.max(index - 1, 0));
  };

  return (
    <main
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-3 px-4 pb-4 pt-8"
      data-testid="onboarding-reflection"
    >
      <OnboardingProgress step={3} total={5} label="Reflection" />

      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Main Content */}
        <div className="space-y-6">
          <header className="space-y-3">
            <OnboardingH1>A few gentle questions</OnboardingH1>
            <OnboardingBody>There are no right answers here. Short responses are enough.</OnboardingBody>
            <OnboardingBody
              className="text-xs font-medium"
              data-testid="reflection-question-counter"
            >
              Question {currentIndex + 1} of {totalQuestions}
            </OnboardingBody>
            {status ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <OnboardingBody className="text-rose-700">{status}</OnboardingBody>
              </div>
            ) : null}
          </header>

          <section
            className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
            data-testid={`reflection-question-${currentQuestion.id}`}
          >
            <div className="flex flex-col gap-3">
              <OnboardingBody
                className="font-serif font-medium"
                data-testid="reflection-current-question"
              >
                {currentQuestion.prompt}
              </OnboardingBody>
              {currentQuestion.helper ? (
                <OnboardingBody className="text-xs">{currentQuestion.helper}</OnboardingBody>
              ) : null}
              {currentQuestion.type === 'text' ? (
                <textarea
                  className="min-h-[80px] rounded-xl border border-slate-200 px-4 py-3 text-base text-text"
                  value={answers[currentQuestion.id] ?? ''}
                  onChange={(event) =>
                    handleAnswerChange(currentQuestion.id, event.target.value)
                  }
                  placeholder="A short note is fine"
                  data-testid={`reflection-input-${currentQuestion.id}`}
                  autoFocus
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {currentQuestion.options?.map((option) => {
                    const selected = answers[currentQuestion.id] === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() =>
                          handleAnswerChange(currentQuestion.id, option)
                        }
                        aria-pressed={selected}
                        data-testid={`reflection-option-${currentQuestion.id}-${option}`}
                        className={`min-h-12 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                          selected
                            ? 'border-accent bg-accent text-white'
                            : 'border-slate-200 bg-white text-text hover:border-slate-300'
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Inline Kenji Guide */}
          <div className="flex justify-center pt-2">
            <OnboardingMonk
              step="reflection"
              size={100}
              message="Take your time with these. There's wisdom in honest reflection."
              
            />
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-full border border-slate-300 px-6 py-3 text-text min-h-12 text-sm"
          onClick={handleBack}
          data-testid="onboarding-back"
        >
          ← Back
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-medium text-white min-h-12 text-sm"
          onClick={handleNext}
          disabled={!repository || !profile}
          data-testid="onboarding-next"
        >
          {isLast ? 'Continue' : 'Next'} <span aria-hidden>→</span>
        </button>
      </footer>
    </main>
  );
}
