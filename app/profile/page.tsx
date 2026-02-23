'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  computeWeeklyCapacity,
  getBufferPercentForStrictness,
  type Profile,
  type Settings,
} from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import SettingsForm from '../../components/SettingsForm';
import { reflectionQuestions } from '../onboarding/reflection/questions';

export default function ProfilePage() {
  const router = useRouter();
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [initialSettings, setInitialSettings] = useState<Settings | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [nameStatus, setNameStatus] = useState<string | null>(null);
  const [reflectionAnswers, setReflectionAnswers] = useState<
    Record<string, string>
  >({});
  const [initialReflectionAnswers, setInitialReflectionAnswers] = useState<
    Record<string, string>
  >({});
  const [reflectionStatus, setReflectionStatus] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);

  const loadData = async (repo: ReturnType<typeof getLocalRepository>) => {
    const [profileRecord, settingsRecord] = await Promise.all([
      repo.getProfile(),
      repo.getSettings(),
    ]);
    if (profileRecord) {
      setProfile(profileRecord);
      setNameInput(profileRecord.name);
      const existingAnswers = profileRecord.reflections.reduce(
        (acc, reflection) => {
          acc[reflection.questionId] = reflection.answer;
          return acc;
        },
        {} as Record<string, string>,
      );
      setReflectionAnswers(existingAnswers);
      setInitialReflectionAnswers(existingAnswers);
    }
    setSettings(settingsRecord);
    setInitialSettings(settingsRecord);
  };

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      loadData(repo).catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, []);

  const handleSaveProfile = async (nextName?: string) => {
    if (!repository) {
      return;
    }
    const trimmed = (nextName ?? nameInput).trim();
    if (!trimmed) {
      setNameStatus('Please enter a name.');
      return;
    }
    const nowIso = new Date().toISOString();
    const nextProfile: Profile = profile
      ? {
          ...profile,
          name: trimmed,
          reflections: reflectionQuestions.map((question) => ({
            questionId: question.id,
            answer: reflectionAnswers[question.id] ?? '',
          })),
          updatedAt: nowIso,
        }
      : {
          id: crypto.randomUUID(),
          name: trimmed,
          reflections: reflectionQuestions.map((question) => ({
            questionId: question.id,
            answer: reflectionAnswers[question.id] ?? '',
          })),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
    await repository.saveProfile(nextProfile);
    await loadData(repository);
    setNameStatus('Saved');
    setReflectionStatus('Saved');
  };

  const handleSettingsChange = <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => {
    if (!settings) {
      return;
    }
    const nextSettings: Settings = {
      ...settings,
      [key]: value,
    };
    if (key === 'strictness') {
      nextSettings.bufferPercent = getBufferPercentForStrictness(
        value as Settings['strictness'],
      );
    }
    setSettings(nextSettings);
  };

  const handleSaveSettings = async () => {
    if (!settings || !repository) {
      return;
    }
    setIsSettingsSaving(true);
    const nowIso = new Date().toISOString();
    const derived = computeWeeklyCapacity({
      sleepHoursPerDay: settings.sleepHoursPerDay,
      maintenanceHoursPerDay: settings.maintenanceHoursPerDay,
      jobHoursPerWeek: settings.jobHoursPerWeek,
      classHoursPerWeek: settings.classHoursPerWeek,
      bufferPercent: getBufferPercentForStrictness(settings.strictness),
    });
    await repository.saveSettings({
      ...settings,
      bufferPercent: getBufferPercentForStrictness(settings.strictness),
      weeklyCapacityHoursDerived: derived.estimatedPlanForHours,
      updatedAt: nowIso,
    });
    await loadData(repository);
    setStatus('Settings saved.');
    setIsSettingsSaving(false);
  };

  const isSettingsDirty = settings && initialSettings
    ? JSON.stringify(settings) !== JSON.stringify(initialSettings)
    : false;
  const isReflectionDirty =
    JSON.stringify(reflectionAnswers) !== JSON.stringify(initialReflectionAnswers);
  const isAnyDirty = isSettingsDirty || isReflectionDirty;

  const handleResetOnboarding = async () => {
    if (!repository) {
      return;
    }
    await repository.resetOnboarding();
    router.replace('/onboarding');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Profile
        </p>
        <h1 className="text-3xl font-semibold text-text">Your profile</h1>
        <p className="text-sm text-mutedText">
          Update your name and weekly defaults in one place.
        </p>
        {status ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {status}
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2 text-sm text-mutedText">
            Name
            <input
              type="text"
              id="profile-name"
              name="profileName"
              className="rounded-xl border border-slate-200 px-3 py-2 text-text"
              value={nameInput}
              onChange={(event) => {
                setNameStatus(null);
                setNameInput(event.target.value);
              }}
              onBlur={() => void handleSaveProfile()}
              placeholder="Your name"
            />
          </label>
          {nameStatus ? (
            <p className="text-xs text-mutedText">{nameStatus}</p>
          ) : null}
          <button
            type="button"
            className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-text"
            onClick={() => void handleResetOnboarding()}
            disabled={!repository}
          >
            Reset onboarding
          </button>
        </div>
      </section>

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
                  value={reflectionAnswers[question.id] ?? ''}
                  onChange={(event) =>
                    setReflectionAnswers((prev) => ({
                      ...prev,
                      [question.id]: event.target.value,
                    }))
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
                        name={`profile-${question.id}`}
                        value={option}
                        checked={reflectionAnswers[question.id] === option}
                        onChange={() =>
                          setReflectionAnswers((prev) => ({
                            ...prev,
                            [question.id]: option,
                          }))
                        }
                      />
                      {option}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
            onClick={() => {
              setReflectionStatus(null);
              void handleSaveProfile();
            }}
            disabled={!repository || !isReflectionDirty}
          >
            {isReflectionDirty ? 'Save reflection answers' : 'Saved'}
          </button>
          {reflectionStatus ? (
            <p className="text-xs text-mutedText">{reflectionStatus}</p>
          ) : null}
        </div>
      </section>

      {settings ? (
        <SettingsForm
          settings={settings}
          onChange={handleSettingsChange}
          onSave={() => void handleSaveSettings()}
          saveLabel={
            isSettingsSaving
              ? 'Saving...'
              : isSettingsDirty
                ? 'Save settings'
                : 'Saved'
          }
          disabled={!repository || !isSettingsDirty || isSettingsSaving}
        />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <p className="text-sm text-mutedText">Loading settings...</p>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-text"
            onClick={async () => {
              await handleSaveProfile();
              await handleSaveSettings();
              setReflectionStatus('Saved');
            }}
            disabled={!repository || !settings || !isAnyDirty}
          >
            {isAnyDirty ? 'Save all changes' : 'Saved'}
          </button>
          <p className="text-xs text-mutedText">This saves everything on the page.</p>
        </div>
      </section>
    </main>
  );
}
