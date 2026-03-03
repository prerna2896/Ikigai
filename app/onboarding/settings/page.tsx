'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBufferPercentForStrictness, type Settings } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import { settingsSteps } from './onboardingConfig';

type WeeklyCapacityMode = 'auto' | 'custom';

type StrictnessOption = Settings['strictness'];

const strictnessOptions: StrictnessOption[] = [
  'very_flexible',
  'somewhat_flexible',
  'structured',
  'very_structured',
];

const professionOptions: Array<{
  label: string;
  value: Settings['professionType'];
}> = [
  { label: 'Full-time employee', value: 'full_time_employee' },
  { label: 'Part-time employee', value: 'part_time_employee' },
  { label: 'Founder / self-employed', value: 'founder_self_employed' },
  { label: 'Student', value: 'student' },
  { label: 'Looking for work', value: 'looking_for_work' },
  { label: 'Caregiver', value: 'caregiver' },
  { label: 'Taking a break / sabbatical', value: 'break_sabbatical' },
  { label: 'Other', value: 'other' },
];

export default function OnboardingSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [weeklyCapacityMode, setWeeklyCapacityMode] =
    useState<WeeklyCapacityMode>('auto');
  const [weeklyCapacityHours, setWeeklyCapacityHours] = useState(0);
  const [strictness, setStrictness] =
    useState<StrictnessOption>('somewhat_flexible');
  const [sleepHoursPerDay, setSleepHoursPerDay] = useState(8);
  const [maintenanceHoursPerDay, setMaintenanceHoursPerDay] = useState(1);
  const [preferredTone, setPreferredTone] = useState<Settings['preferredTone']>(
    null,
  );
  const [weekStartDay, setWeekStartDay] =
    useState<Settings['weekStartDay']>('sunday');
  const [weekTimeZone, setWeekTimeZone] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [professionType, setProfessionType] =
    useState<Settings['professionType']>('full_time_employee');
  const [professionOtherText, setProfessionOtherText] = useState('');
  const [jobHoursPerWeek, setJobHoursPerWeek] = useState(0);
  const [classHoursPerWeek, setClassHoursPerWeek] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const stepParam = searchParams?.get('step');
    if (stepParam) {
      const parsed = Number(stepParam);
      if (!Number.isNaN(parsed) && parsed >= 1) {
        setActiveStepIndex(Math.min(parsed - 1, settingsSteps.length - 1));
      }
    }
  }, [searchParams]);

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      Promise.all([repo.getSettings(), repo.getProfile()])
        .then(([settings, profile]) => {
          if (!profile) {
            router.replace('/onboarding/context');
            return;
          }
          if (profile.reflections.length === 0) {
            router.replace('/onboarding/reflection');
            return;
          }
          setWeeklyCapacityHours(settings.weeklyCapacityHours);
          const isAuto =
            settings.weeklyCapacityHours === settings.weeklyCapacityHoursDerived;
          setWeeklyCapacityMode(isAuto ? 'auto' : 'custom');
          setStrictness(settings.strictness);
          setSleepHoursPerDay(settings.sleepHoursPerDay);
          setMaintenanceHoursPerDay(settings.maintenanceHoursPerDay);
          setPreferredTone(settings.preferredTone ?? null);
          setWeekStartDay(settings.weekStartDay ?? 'sunday');
          setWeekTimeZone(
            settings.weekTimeZone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              'UTC',
          );
          setProfessionType(settings.professionType);
          setProfessionOtherText(settings.professionOtherText ?? '');
          setJobHoursPerWeek(settings.jobHoursPerWeek);
          setClassHoursPerWeek(settings.classHoursPerWeek);
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, [router]);

  const activeStep = settingsSteps[activeStepIndex];
  const isLastStep = activeStepIndex === settingsSteps.length - 1;
  const bufferPercent = getBufferPercentForStrictness(strictness);
  const totalWeekHours = 168;
  const availableAfterBuffer = Math.round(
    totalWeekHours * (1 - bufferPercent / 100),
  );
  const preferredPercent =
    weeklyCapacityHours >= 0 && availableAfterBuffer > 0
      ? Math.round((weeklyCapacityHours / availableAfterBuffer) * 100)
      : null;

  useEffect(() => {
    if (weeklyCapacityMode === 'auto') {
      setWeeklyCapacityHours(availableAfterBuffer);
    }
  }, [availableAfterBuffer, weeklyCapacityMode]);

  const handleNext = () => {
    if (isLastStep) {
      return;
    }
    setActiveStepIndex((prev) => Math.min(prev + 1, settingsSteps.length - 1));
  };

  const handleBack = () => {
    setActiveStepIndex((prev) => {
      if (prev <= 0) {
        router.push('/');
        return prev;
      }
      return prev - 1;
    });
  };

  const handleComplete = async () => {
    if (!repository) {
      return;
    }
    const nowIso = new Date().toISOString();
    const isStudentSelection = professionType === 'student';
    const derivedHours = Math.round(168 * (1 - bufferPercent / 100));
    const settings: Settings = {
      id: 'singleton',
      weeklyCapacityHours,
      weeklyCapacityHoursDerived: derivedHours,
      strictness,
      bufferPercent,
      weekStartDay,
      weekTimeZone,
      preferredTone,
      professionType,
      professionOtherText: professionOtherText.trim() || null,
      hasJob: !isStudentSelection,
      jobHoursPerWeek: isStudentSelection ? 0 : jobHoursPerWeek,
      isStudent: isStudentSelection,
      classHoursPerWeek: isStudentSelection ? classHoursPerWeek : 0,
      sleepHoursPerDay,
      maintenanceHoursPerDay,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await repository.saveSettings(settings);
    router.replace('/week/plan');
  };

  return (
    <main
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12"
      data-testid="onboarding-settings"
    >
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
            Settings
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
        <h1 className="text-3xl font-semibold text-text">{activeStep.title}</h1>
        {activeStep.helper ? (
          <p className="text-sm text-mutedText">{activeStep.helper}</p>
        ) : null}
        {status ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {status}
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        {activeStep.id === 'weekly_capacity' ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <p className="text-sm text-mutedText">
                How structured do you want your planning to be right now?
              </p>
              {strictnessOptions.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text"
                >
                  <input
                    type="radio"
                    name="strictness"
                    value={option}
                    checked={strictness === option}
                    onChange={() => setStrictness(option)}
                    data-testid={`settings-strictness-${option}`}
                  />
                  <span className="font-medium">
                    {option.replace('_', ' ')}
                  </span>
                  <span className="ml-auto text-mutedText">
                    {getBufferPercentForStrictness(option)}% buffer
                  </span>
                </label>
              ))}
              <p className="text-xs text-mutedText">
                This only affects how much buffer we keep.
              </p>
            </div>
            <label className="flex flex-col gap-2 text-sm text-mutedText">
              When should your week start?
              <select
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text"
                value={weekStartDay}
                onChange={(event) =>
                  setWeekStartDay(event.target.value as Settings['weekStartDay'])
                }
              >
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
                <option value="tuesday">Tuesday</option>
                <option value="wednesday">Wednesday</option>
                <option value="thursday">Thursday</option>
                <option value="friday">Friday</option>
                <option value="saturday">Saturday</option>
              </select>
              <span className="text-xs text-mutedText">Weeks reset at 12:00 AM.</span>
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text">
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="weekly-capacity"
                  value="auto"
                  checked={weeklyCapacityMode === 'auto'}
                  onChange={() => setWeeklyCapacityMode('auto')}
                />
                <span className="font-medium">Use buffered week</span>
              </div>
              <span className="text-mutedText">
                {availableAfterBuffer}h
                <span className="ml-2">
                  {availableAfterBuffer > 0 ? '(100%)' : '(0%)'}
                </span>
              </span>
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text">
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="weekly-capacity"
                  value="custom"
                  checked={weeklyCapacityMode === 'custom'}
                  onChange={() => setWeeklyCapacityMode('custom')}
                />
                <span className="font-medium">Choose hours to plan</span>
              </div>
              <span className="text-mutedText">
                {weeklyCapacityHours}h
                <span className="ml-2">
                  {availableAfterBuffer > 0
                    ? `(${Math.round(
                        (weeklyCapacityHours / availableAfterBuffer) * 100,
                      )}%)`
                    : '(0%)'}
                </span>
              </span>
            </label>
            <div className="flex flex-col gap-3 text-sm text-mutedText">
              <div className="flex items-center justify-between">
                <span>Hours to plan</span>
                <span className="text-text">{weeklyCapacityHours}h</span>
              </div>
              <input
                type="range"
                min={0}
                max={totalWeekHours}
                step={1}
                className="w-full accent-[var(--accent)]"
                value={weeklyCapacityHours}
                disabled={weeklyCapacityMode !== 'custom'}
                onChange={(event) => {
                  setWeeklyCapacityMode('custom');
                  setWeeklyCapacityHours(
                    Number(event.target.value.replace(/^0+(?=\\d)/, '')),
                  );
                }}
              />
              <div className="flex items-center justify-between text-xs text-mutedText">
                <span>0h</span>
                <span>{totalWeekHours}h</span>
              </div>
            </div>
            {preferredPercent !== null ? (
              <p className="text-xs text-mutedText">
                That’s roughly {preferredPercent}% of your buffered week.
              </p>
            ) : null}
            <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <summary className="cursor-pointer text-sm text-mutedText">
                How this is calculated
              </summary>
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-xs text-mutedText">
                  This step starts with the full week, then applies your buffer.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-mutedText">Total in a week</span>
                  <span className="text-text">{totalWeekHours}h</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-mutedText">
                    Buffer ({bufferPercent}%)
                  </span>
                  <span className="text-text">
                    -{Math.round((totalWeekHours * bufferPercent) / 100)}h
                  </span>
                </div>
                <div className="flex items-center justify-between font-medium">
                  <span className="text-mutedText">Available after buffer</span>
                  <span className="text-text">{availableAfterBuffer}h</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-mutedText">Preference (hours to plan)</span>
                  <span className="text-text">{weeklyCapacityHours}h</span>
                </div>
                {preferredPercent !== null ? (
                  <div className="flex items-center justify-between">
                    <span className="text-mutedText">Share of available time</span>
                    <span className="text-text">{preferredPercent}%</span>
                  </div>
                ) : null}
              </div>
            </details>
          </div>
        ) : null}

        {activeStep.id === 'strictness' ? null : null}

        {activeStep.id === 'commitments' ? (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-mutedText">
              What best describes your current situation?
              <select
                className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                value={professionType}
                onChange={(event) => {
                  const nextType = event.target.value as Settings['professionType'];
                  setProfessionType(nextType);
                  if (nextType === 'student') {
                    setClassHoursPerWeek((prev) => (prev === 0 ? 15 : prev));
                    setJobHoursPerWeek(0);
                  } else {
                    setJobHoursPerWeek((prev) => (prev === 0 ? 40 : prev));
                    setClassHoursPerWeek(0);
                  }
                  if (nextType !== 'other' && nextType !== 'caregiver') {
                    setProfessionOtherText('');
                  }
                }}
                data-testid="settings-profession-select"
              >
                {professionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {professionType === 'other' || professionType === 'caregiver' ? (
              <label className="flex flex-col gap-2 text-sm text-mutedText">
                Optional: describe in a few words
                <input
                  type="text"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                  value={professionOtherText}
                  onChange={(event) => setProfessionOtherText(event.target.value)}
                  data-testid="settings-profession-other"
                />
              </label>
            ) : null}
            {professionType === 'student' ? (
              <label className="flex flex-col gap-2 text-sm text-mutedText">
                About how many hours per week are classes or scheduled study?
                <input
                  type="number"
                  min={0}
                  max={80}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                  value={classHoursPerWeek}
                  onChange={(event) =>
                    setClassHoursPerWeek(
                      Number(event.target.value.replace(/^0+(?=\\d)/, '')),
                    )
                  }
                  onFocus={(event) => {
                    if (classHoursPerWeek === 0) {
                      setClassHoursPerWeek(15);
                    }
                    event.currentTarget.select();
                  }}
                  data-testid="settings-class-hours"
                />
                {classHoursPerWeek > 80 ? (
                  <span className="text-xs text-mutedText">
                    That seems high — but you can keep it if it’s accurate.
                  </span>
                ) : null}
              </label>
            ) : (
              <label className="flex flex-col gap-2 text-sm text-mutedText">
                {professionType === 'caregiver'
                  ? `About how many hours per week are dedicated to ${
                      professionOtherText.trim() || 'caregiving'
                    }?`
                  : 'About how many hours per week do you want to reserve for it?'}
                <input
                  type="number"
                  min={0}
                  max={80}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                  value={jobHoursPerWeek}
                  onChange={(event) =>
                    setJobHoursPerWeek(
                      Number(event.target.value.replace(/^0+(?=\\d)/, '')),
                    )
                  }
                  onFocus={(event) => {
                    if (jobHoursPerWeek === 0) {
                      setJobHoursPerWeek(40);
                    }
                    event.currentTarget.select();
                  }}
                  data-testid="settings-job-hours"
                />
                {jobHoursPerWeek > 80 ? (
                  <span className="text-xs text-mutedText">
                    That seems high — but you can keep it if it’s accurate.
                  </span>
                ) : null}
              </label>
            )}
            <p className="text-xs text-mutedText">A rough estimate is enough.</p>
          </div>
        ) : null}

        {activeStep.id === 'daily_baselines' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-mutedText">
              Sleep per day (hours)
                <input
                  type="number"
                  min={0}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                  value={sleepHoursPerDay}
                  onChange={(event) =>
                    setSleepHoursPerDay(
                      Number(event.target.value.replace(/^0+(?=\\d)/, '')),
                    )
                  }
                  onFocus={(event) => event.currentTarget.select()}
                  data-testid="settings-sleep-hours"
                />
            </label>
            <label className="flex flex-col gap-2 text-sm text-mutedText">
              Daily maintenance (hours)
                <input
                  type="number"
                  min={0}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                  value={maintenanceHoursPerDay}
                  onChange={(event) =>
                    setMaintenanceHoursPerDay(
                      Number(event.target.value.replace(/^0+(?=\\d)/, '')),
                    )
                  }
                  onFocus={(event) => event.currentTarget.select()}
                  data-testid="settings-maintenance-hours"
                />
            </label>
          </div>
        ) : null}
      </section>

      <footer className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="rounded-full border border-slate-300 px-4 py-2 text-text"
          onClick={handleBack}
          data-testid="onboarding-back"
        >
          Back
        </button>
        <div className="text-mutedText" data-testid="onboarding-settings-step">
          Step {activeStepIndex + 1} of {settingsSteps.length}
        </div>
        {isLastStep ? (
          <button
            type="button"
            className="rounded-full bg-accent px-5 py-2 font-medium text-white"
            onClick={() => void handleComplete()}
            disabled={!repository}
            data-testid="onboarding-finish"
          >
            Finish setup
          </button>
        ) : (
          <div className="flex items-center gap-3">
            {activeStep.id === 'weekly_capacity' ? (
              <button
                type="button"
                className="rounded-full border border-slate-300 px-4 py-2 text-text"
                onClick={() => {
                  setWeeklyCapacityMode('auto');
                  setWeeklyCapacityHours(availableAfterBuffer);
                  handleNext();
                }}
                disabled={!repository}
              >
                Skip for now
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-full bg-accent px-5 py-2 font-medium text-white"
              onClick={handleNext}
              disabled={!repository}
              data-testid="onboarding-next"
            >
              Continue
            </button>
          </div>
        )}
      </footer>
    </main>
  );
}
