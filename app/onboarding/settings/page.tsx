'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBufferPercentForStrictness, type Settings } from '@ikigai/core';
import { settingsSteps } from './onboardingConfig';
import { OnboardingProgress } from '../../../components/OnboardingProgress';
import OnboardingMonk from '../../../components/OnboardingMonk';
import { OnboardingH1, OnboardingBody, OnboardingLabel } from '../../../components/OnboardingTypography';
import { useRepository } from '../../../components/RepositoryProvider';

type WeeklyCapacityMode = 'auto' | 'custom';

type StrictnessOption = Settings['strictness'];

const strictnessOptions: StrictnessOption[] = [
  'very_flexible',
  'somewhat_flexible',
  'structured',
  'very_structured',
  'no_buffer',
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

function OnboardingSettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profileRepo, settingsRepo } = useRepository();
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
    if (!profileRepo || !settingsRepo) return;
    let cancelled = false;
    Promise.all([settingsRepo.getSettings(), profileRepo.getProfile()])
      .then(([settings, profile]) => {
        if (cancelled) return;
        if (!profile) {
          router.replace('/onboarding/context');
          return;
        }
        if (profile.reflections.length === 0) {
          router.replace('/onboarding/reflection');
          return;
        }
        setWeeklyCapacityHours(settings.weeklyCapacityHours);
          // Treat as auto if the stored value matches derived, or if it's
          // still the hardcoded default (40h) meaning the user hasn't set it yet.
          const isAuto =
            settings.weeklyCapacityHours === settings.weeklyCapacityHoursDerived ||
            settings.weeklyCapacityHours === 40;
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
      .catch((error) => {
        if (!cancelled) setStatus(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [router, profileRepo, settingsRepo]);

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
        router.push('/onboarding/reflection?q=4');
        return prev;
      }
      return prev - 1;
    });
  };

  const handleComplete = async () => {
    if (!settingsRepo) return;
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
    await settingsRepo.saveSettings(settings);
    router.replace('/week/plan');
  };

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pb-24 md:pb-4 pt-8">
      <main
        className="w-full max-w-5xl mx-auto"
        data-testid="onboarding-settings"
      >
        {/* Progress */}
        <div className="mb-6">
          <OnboardingProgress step={5} total={5} label="Settings" />
        </div>

        {/* Main Content Area */}
        <div className="space-y-6 max-w-2xl mx-auto mb-8">
          <header className="text-center space-y-2">
            <OnboardingH1>{activeStep.title}</OnboardingH1>
            {activeStep.helper && (
              <OnboardingBody>{activeStep.helper}</OnboardingBody>
            )}
            {status && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 mt-3">
                <OnboardingBody className="text-rose-700">{status}</OnboardingBody>
              </div>
            )}
          </header>

            {/* Step Content */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              {activeStep.id === 'commitments' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <OnboardingLabel className="font-medium">
                      What describes you best?
                    </OnboardingLabel>
                    <div className="space-y-2">
                      {professionOptions.map((option) => (
                        <label
                          key={option.value}
                          className={`flex items-center space-x-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                            professionType === option.value
                              ? 'border-accent bg-accent/5'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="professionType"
                            value={option.value}
                            checked={professionType === option.value}
                            onChange={(e) =>
                              setProfessionType(
                                e.target.value as Settings['professionType']
                              )
                            }
                            className="w-4 h-4 text-accent"
                          />
                          <span className="font-medium">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {professionType === 'other' && (
                    <div className="space-y-3">
                      <OnboardingLabel className="font-medium">
                        Please specify
                      </OnboardingLabel>
                      <input
                        type="text"
                        className="settings-input"
                        value={professionOtherText}
                        onChange={(e) => setProfessionOtherText(e.target.value)}
                        placeholder="Your situation..."
                      />
                    </div>
                  )}

                  {professionType !== 'student' &&
                    professionType !== 'looking_for_work' &&
                    professionType !== 'break_sabbatical' && (
                      <div className="space-y-3">
                        <OnboardingLabel className="font-medium">
                          Hours per week at work
                        </OnboardingLabel>
                        <input
                          type="number"
                          min="0"
                          max="168"
                          style={{
                            width: '100%',
                            minHeight: '48px',
                            padding: '12px 16px',
                            fontSize: '16px',
                            borderRadius: '12px',
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#ffffff'
                          }}
                          className="text-text focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-colors"
                          value={jobHoursPerWeek || ''}
                          onChange={(e) =>
                            setJobHoursPerWeek(Number(e.target.value))
                          }
                        />
                      </div>
                    )}

                  {professionType === 'student' && (
                    <div className="space-y-3">
                      <OnboardingLabel className="font-medium">
                        Hours per week in class
                      </OnboardingLabel>
                      <input
                        type="number"
                        min="0"
                        max="168"
                        className="settings-input"
                        value={classHoursPerWeek || ''}
                        onChange={(e) =>
                          setClassHoursPerWeek(Number(e.target.value))
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {activeStep.id === 'daily_baselines' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <OnboardingLabel className="font-medium">
                      Sleep hours per day
                    </OnboardingLabel>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      step="0.5"
                      className="settings-input"
                      value={sleepHoursPerDay || ''}
                      onChange={(e) =>
                        setSleepHoursPerDay(Number(e.target.value))
                      }
                    />
                    <p className="text-xs text-mutedText">
                      The amount you actually need, not what you&apos;d like.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <OnboardingLabel className="font-medium">
                      Daily maintenance hours
                    </OnboardingLabel>
                    <input
                      type="number"
                      min="0"
                      max="12"
                      step="0.5"
                      className="settings-input"
                      value={maintenanceHoursPerDay || ''}
                      onChange={(e) =>
                        setMaintenanceHoursPerDay(Number(e.target.value))
                      }
                    />
                    <p className="text-xs text-mutedText">
                      Meals, chores, commuting, getting ready.
                    </p>
                  </div>
                </div>
              )}

              {activeStep.id === 'weekly_structure' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <OnboardingLabel className="font-medium">
                      How structured should planning feel?
                    </OnboardingLabel>
                    <div className="space-y-2">
                      {strictnessOptions.map((option) => (
                        <label
                          key={option}
                          className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-colors ${
                            strictness === option
                              ? 'border-accent bg-accent/5'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <input
                              type="radio"
                              name="strictness"
                              value={option}
                              checked={strictness === option}
                              onChange={() => setStrictness(option)}
                              data-testid={`settings-strictness-${option}`}
                              className="w-4 h-4 text-accent"
                            />
                            <span className="font-medium capitalize">
                              {option.replace('_', ' ')}
                            </span>
                          </div>
                          <span className="text-sm text-mutedText">
                            {getBufferPercentForStrictness(option)}% buffer
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-mutedText">
                      This affects how much buffer time we keep aside for
                      unexpected things.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <OnboardingLabel className="font-medium">
                      When should your week start?
                    </OnboardingLabel>
                    <select
                      className="settings-input"
                      value={weekStartDay}
                      onChange={(event) =>
                        setWeekStartDay(
                          event.target.value as Settings['weekStartDay']
                        )
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
                    <p className="text-xs text-mutedText">
                      Weeks reset at 12:00 AM.
                    </p>
                  </div>
                </div>
              )}

              {activeStep.id === 'weekly_capacity' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <OnboardingLabel className="font-medium">
                      Weekly capacity mode
                    </OnboardingLabel>
                    <div className="space-y-2">
                      <label className="flex items-center space-x-3 p-4 rounded-xl border cursor-pointer transition-colors border-slate-200 hover:border-slate-300">
                        <input
                          type="radio"
                          name="weeklyCapacityMode"
                          value="auto"
                          checked={weeklyCapacityMode === 'auto'}
                          onChange={() => setWeeklyCapacityMode('auto')}
                          className="w-4 h-4 text-accent"
                        />
                        <div>
                          <div className="font-medium">Auto</div>
                          <div className="text-sm text-mutedText">
                            Use available hours after buffer ({availableAfterBuffer}h)
                          </div>
                        </div>
                      </label>
                      <label className="flex items-center space-x-3 p-4 rounded-xl border cursor-pointer transition-colors border-slate-200 hover:border-slate-300">
                        <input
                          type="radio"
                          name="weeklyCapacityMode"
                          value="custom"
                          checked={weeklyCapacityMode === 'custom'}
                          onChange={() => setWeeklyCapacityMode('custom')}
                          className="w-4 h-4 text-accent"
                        />
                        <div>
                          <div className="font-medium">Custom</div>
                          <div className="text-sm text-mutedText">
                            Set your own target hours
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>

                  {weeklyCapacityMode === 'custom' && (
                    <div className="space-y-3">
                      <OnboardingLabel className="font-medium">
                        Target hours per week
                      </OnboardingLabel>
                      <input
                        type="number"
                        min="1"
                        max={availableAfterBuffer}
                        className="settings-input"
                        value={weeklyCapacityHours || ''}
                        onChange={(e) =>
                          setWeeklyCapacityHours(Number(e.target.value))
                        }
                      />
                      {preferredPercent !== null && (
                        <p className="text-xs text-mutedText">
                          That&apos;s about {preferredPercent}% of your available time
                          after buffer.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="text-sm">
                      <div className="font-medium text-blue-900 mb-1">
                        Current breakdown:
                      </div>
                      <div className="text-blue-800 space-y-1 text-xs">
                        <div>Total week: 168 hours</div>
                        <div>
                          Buffer ({bufferPercent}%): ~
                          {Math.round(totalWeekHours * (bufferPercent / 100))}h
                        </div>
                        <div>Available: {availableAfterBuffer}h</div>
                        <div>Your target: {weeklyCapacityHours}h</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

          {/* Inline Kenji */}
          <div className="flex justify-center pt-4">
            <OnboardingMonk
              step="settings"
              size={100}
              
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="sticky bottom-0 -mx-4 md:mx-0 md:static bg-bg/95 backdrop-blur border-t border-slate-200 md:border-0 px-4 py-3 md:p-0 mt-8 flex items-center justify-between text-sm">
          <button
            type="button"
            className="rounded-full border border-slate-300 px-6 py-3 min-h-12 text-sm text-text hover:bg-slate-50 transition-colors"
            onClick={handleBack}
            data-testid="onboarding-back"
          >
            ← Back
          </button>
          <OnboardingBody className="text-xs font-medium" data-testid="onboarding-settings-step">
            Step {activeStepIndex + 1} of {settingsSteps.length}
          </OnboardingBody>
          {isLastStep ? (
            <button
              type="button"
              className="rounded-full bg-accent px-6 py-3 min-h-12 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
              onClick={() => void handleComplete()}
              disabled={!settingsRepo}
              data-testid="onboarding-finish"
            >
              Finish setup
            </button>
          ) : (
            <button
              type="button"
              className="rounded-full bg-accent px-6 py-3 min-h-12 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
              onClick={handleNext}
              disabled={!settingsRepo}
              data-testid="onboarding-next"
            >
              Continue
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}

export default function OnboardingSettingsPage() {
  return (
    <Suspense>
      <OnboardingSettingsContent />
    </Suspense>
  );
}
