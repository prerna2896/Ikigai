'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Profile } from '@ikigai/core';
import { OnboardingProgress } from '../../../components/OnboardingProgress';
import OnboardingMonk from '../../../components/OnboardingMonk';
import { useRepository } from '../../../components/RepositoryProvider';
import { useStashedField } from '../../../lib/useStashedField';
import { StashRestoreBanner } from '../../../components/StashRestoreBanner';

const STASH_KEY = 'onboarding.goalText';

type GoalEntry = {
  text: string;
  timeline: string;
  createdAt: string;
};

const LIFE_AREAS = [
  { name: 'Health & Fitness', icon: '🏃' },
  { name: 'Career & Work', icon: '💼' },
  { name: 'Family & Relationships', icon: '❤️' },
  { name: 'Learning & Growth', icon: '📚' },
  { name: 'Creativity', icon: '🎨' },
  { name: 'Travel & Adventure', icon: '✈️' },
  { name: 'Finance', icon: '💰' },
  { name: 'Rest & Wellbeing', icon: '🌿' },
  { name: 'Personal Projects', icon: '⚡' },
  { name: 'Community', icon: '🤝' },
];

const EXAMPLE_GOALS = [
  'Get to 10k steps daily',
  'Read 2 books this month',
  'Build a personal website',
];

const TIMELINE_OPTIONS = [
  { label: '1 week', value: '1_week' },
  { label: '2 weeks', value: '2_weeks' },
  { label: '1 month', value: '1_month' },
  { label: '3 months', value: '3_months' },
  { label: '6 months', value: '6_months' },
  { label: '1 year', value: '1_year' },
];

export default function OnboardingGoalsPage() {
  const router = useRouter();
  const { profileRepo } = useRepository();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [goals, setGoals] = useState<GoalEntry[]>([]);
  const {
    value: goalText,
    setValue: setGoalText,
    pendingRestore: goalTextRestore,
    restore: restoreGoalText,
    discard: discardGoalText,
    clear: clearGoalText,
  } = useStashedField<string>(STASH_KEY, '');
  const [goalTimeline, setGoalTimeline] = useState('1_month');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!profileRepo) return;
    let cancelled = false;
    profileRepo
      .getProfile()
      .then((profileRecord) => {
        if (cancelled) return;
        if (!profileRecord) {
          router.replace('/onboarding/context');
          return;
        }
        setProfile(profileRecord);
        if (profileRecord.lifeAreas) {
          setSelectedAreas(profileRecord.lifeAreas);
        }
        if (profileRecord.goals) {
          setGoals(profileRecord.goals);
        }
      })
      .catch((error) => {
        if (!cancelled) setStatus(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [router, profileRepo]);

  const toggleArea = (name: string) => {
    setSelectedAreas((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name],
    );
  };

  const handleExampleGoal = (text: string) => {
    setGoalText(text);
  };

  const handleAddGoal = () => {
    const trimmed = goalText.trim();
    if (!trimmed) return;
    const newGoal: GoalEntry = {
      text: trimmed,
      timeline: goalTimeline,
      createdAt: new Date().toISOString(),
    };
    setGoals((prev) => [...prev, newGoal]);
    setGoalText('');
    // Goal captured into `goals` — the input's stash is stale now.
    clearGoalText();
    setGoalTimeline('1_month');
  };

  const handleRemoveGoal = (index: number) => {
    setGoals((prev) => prev.filter((_, i) => i !== index));
  };

  const handleContinue = async () => {
    if (!profileRepo || !profile) return;
    const nowIso = new Date().toISOString();
    const updatedProfile: Profile = {
      ...profile,
      lifeAreas: selectedAreas,
      goals,
      updatedAt: nowIso,
    };
    await profileRepo.saveProfile(updatedProfile);
    router.replace('/onboarding/settings');
  };

  return (
    <main
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-3 px-4 pb-4 pt-4"
      data-testid="onboarding-goals"
    >
      <OnboardingProgress step={4} total={5} label="Domains" />

      <div className="grid md:grid-cols-2 gap-3 items-start">
        {/* Main Content */}
        <div className="space-y-4">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Life Areas & Goals
            </p>
            <h1 className="text-2xl font-semibold text-text">
              What areas matter most to you?
            </h1>
            <p className="text-sm text-mutedText">
              Pick any that feel relevant right now. You can always change these
              later.
            </p>
            {status ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {status}
              </div>
            ) : null}
          </header>

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LIFE_AREAS.map((area) => {
            const isSelected = selectedAreas.includes(area.name);
            return (
              <button
                key={area.name}
                type="button"
                onClick={() => toggleArea(area.name)}
                className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  isSelected
                    ? 'border-accent bg-accent text-white'
                    : 'border-slate-200 bg-white text-text hover:border-slate-300'
                }`}
                data-testid={`life-area-${area.name.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <span>{area.icon}</span>
                <span>{area.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-text">
            Any goals you&apos;d like to track?
          </h2>
          <p className="mt-1 text-sm text-mutedText">
            Optional — but having one or two makes planning more intentional.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {EXAMPLE_GOALS.map((eg) => (
            <button
              key={eg}
              type="button"
              onClick={() => handleExampleGoal(eg)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-text transition-colors hover:border-accent hover:text-accent"
            >
              {eg}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <div className="flex flex-col gap-3">
            {goalTextRestore !== null ? (
              <StashRestoreBanner
                onRestore={restoreGoalText}
                onDiscard={discardGoalText}
              />
            ) : null}
            <label className="flex flex-col gap-2 text-sm text-mutedText">
              Add a goal
              <input
                type="text"
                className="min-h-11 rounded-xl border border-slate-200 px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                placeholder="e.g. Exercise 3x a week"
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddGoal();
                }}
                data-testid="goal-input"
              />
            </label>
            <div className="flex items-end gap-3">
              <label className="flex flex-1 flex-col gap-2 text-sm text-mutedText">
                Timeline
                <select
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                  value={goalTimeline}
                  onChange={(e) => setGoalTimeline(e.target.value)}
                  data-testid="goal-timeline"
                >
                  {TIMELINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleAddGoal}
                disabled={!goalText.trim()}
                className="min-h-11 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                data-testid="add-goal-btn"
              >
                Add goal
              </button>
            </div>
          </div>

          {goals.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {goals.map((goal, index) => (
                <li
                  key={`${goal.text}-${index}`}
                  className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-sm text-text"
                >
                  <span>{goal.text}</span>
                  <span className="text-xs text-mutedText">
                    ·{' '}
                    {TIMELINE_OPTIONS.find((o) => o.value === goal.timeline)
                      ?.label ?? goal.timeline}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveGoal(index)}
                    className="ml-1 text-mutedText hover:text-text"
                    aria-label={`Remove goal: ${goal.text}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
        </div>

        {/* Kenji Guide */}
        <div className="flex justify-center md:justify-start">
          <OnboardingMonk
            step="goals"
            size={140}
            message="Choose what resonates with you right now. Goals can always evolve."
            
          />
        </div>
      </div>

      <footer className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-full border border-slate-300 px-4 py-2 text-text"
          onClick={() => router.replace('/onboarding/reflection')}
          data-testid="onboarding-back"
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-full bg-accent px-5 py-2 font-medium text-white"
          onClick={() => void handleContinue()}
          disabled={!profileRepo || !profile}
          data-testid="onboarding-next"
        >
          Continue
        </button>
      </footer>
    </main>
  );
}
