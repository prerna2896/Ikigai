'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  computeWeeklyCapacity,
  DOMAIN_COLOR_TOKENS,
  getBufferPercentForStrictness,
  type Domain,
  type Profile,
  type Settings,
} from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';

const strictnessOptions: Settings['strictness'][] = [
  'very_flexible',
  'somewhat_flexible',
  'structured',
  'very_structured',
];

const pickNextColor = (domains: Domain[]) => {
  const usedCount = domains.length;
  return DOMAIN_COLOR_TOKENS[usedCount % DOMAIN_COLOR_TOKENS.length];
};

export default function DbPlaygroundPage() {
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [newDomainName, setNewDomainName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  const refresh = useCallback(
    async (repo: ReturnType<typeof getLocalRepository>) => {
      const [domainList, settingsRecord, profileRecord] = await Promise.all([
        repo.listDomains(),
        repo.getSettings(),
        repo.getProfile(),
      ]);
      setDomains(domainList);
      setSettings(settingsRecord);
      setProfile(profileRecord);
    },
    [],
  );

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      setStorageReady(true);
      refresh(repo).catch((error) => {
        setStatus(String(error));
      });
    } catch (error) {
      setStatus(String(error));
    }
  }, [refresh]);

  const handleAddDomain = async () => {
    if (!repository) {
      return;
    }
    const trimmed = newDomainName.trim();
    if (!trimmed) {
      return;
    }
    const nowIso = new Date().toISOString();
    const domain: Domain = {
      id: crypto.randomUUID(),
      name: trimmed,
      colorToken: pickNextColor(domains),
      createdAt: nowIso,
      updatedAt: nowIso,
      archivedAt: null,
    };
    await repository.upsertDomain(domain);
    setNewDomainName('');
    await refresh(repository);
  };

  const handleArchiveDomain = async (domainId: string) => {
    if (!repository) {
      return;
    }
    await repository.archiveDomain(domainId);
    await refresh(repository);
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
    await refresh(repository);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
          Development Playground
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">
          IndexedDB data check
        </h1>
        <p className="text-sm text-slate-600">
          Use this page to create domains and edit settings. Data persists
          locally across refreshes.
        </p>
        {status ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {status}
          </div>
        ) : null}
        {!storageReady && !status ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            Initializing local storage…
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Domains</h2>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-1 flex-col gap-2 text-sm text-slate-600">
            New domain name
            <input
              id="new-domain-name"
              name="newDomainName"
              className="rounded-xl border border-slate-200 px-3 py-2 text-slate-900"
              value={newDomainName}
              onChange={(event) => setNewDomainName(event.target.value)}
              placeholder="Relationships"
            />
          </label>
          <button
            type="button"
            className="inline-flex w-full items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleAddDomain()}
            disabled={!repository}
          >
            Add domain
          </button>
          {!repository ? (
            <p className="text-xs text-amber-700">
              Storage is still initializing. The button will enable once ready.
            </p>
          ) : null}
        </div>
        <ul className="mt-6 space-y-3">
          {domains.length === 0 ? (
            <li className="text-sm text-slate-500">
              No domains yet. Add one to get started.
            </li>
          ) : (
            domains.map((domain) => (
              <li
                key={domain.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-slate-900">
                    {domain.name}
                  </span>
                  <span className="text-xs text-slate-500">
                    {domain.archivedAt ? 'Archived' : 'Active'} ·{' '}
                    {domain.colorToken}
                  </span>
                </div>
                {domain.archivedAt ? null : (
                  <button
                    className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600"
                    onClick={() => void handleArchiveDomain(domain.id)}
                  >
                    Archive
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Profile (read-only)</h2>
        {profile ? (
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <div>
              <span className="text-slate-500">Name:</span> {profile.name}
            </div>
            <div>
              <span className="text-slate-500">Profile ID:</span> {profile.id}
            </div>
            <div>
              <span className="text-slate-500">Reflections:</span>
              {profile.reflections.length === 0 ? (
                <span className="ml-2 text-slate-500">None yet</span>
              ) : (
                <ul className="mt-2 space-y-2">
                  {profile.reflections.map((reflection) => (
                    <li key={reflection.questionId} className="text-slate-600">
                      <span className="font-medium">
                        {reflection.questionId}:
                      </span>{' '}
                      {reflection.answer || '(empty)'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            No profile stored yet.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Settings</h2>
        <button
          type="button"
          className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleSaveSettings()}
          disabled={!repository || !settings}
        >
          Save settings
        </button>
        {settings ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2 text-sm text-slate-600">
              Planning buffer
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
                {settings.bufferPercent}%
              </div>
            </div>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Sleep hours per day
              <input
                id="sleep-hours-per-day"
                name="sleepHoursPerDay"
                type="number"
                min={0}
                className="rounded-xl border border-slate-200 px-3 py-2 text-slate-900"
                value={settings.sleepHoursPerDay}
                onChange={(event) =>
                  handleSettingsChange(
                    'sleepHoursPerDay',
                    Number(event.target.value.replace(/^0+(?=\\d)/, '')),
                  )
                }
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Maintenance hours per day
              <input
                id="maintenance-hours-per-day"
                name="maintenanceHoursPerDay"
                type="number"
                min={0}
                className="rounded-xl border border-slate-200 px-3 py-2 text-slate-900"
                value={settings.maintenanceHoursPerDay}
                onChange={(event) =>
                  handleSettingsChange(
                    'maintenanceHoursPerDay',
                    Number(event.target.value.replace(/^0+(?=\\d)/, '')),
                  )
                }
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Weekly capacity hours
              <input
                id="weekly-capacity-hours"
                name="weeklyCapacityHours"
                type="number"
                min={0}
                className="rounded-xl border border-slate-200 px-3 py-2 text-slate-900"
                value={settings.weeklyCapacityHours}
                onChange={(event) =>
                  handleSettingsChange(
                    'weeklyCapacityHours',
                    Number(event.target.value.replace(/^0+(?=\\d)/, '')),
                  )
                }
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              Strictness
              <select
                id="strictness"
                name="strictness"
                className="rounded-xl border border-slate-200 px-3 py-2 text-slate-900"
                value={settings.strictness}
                onChange={(event) =>
                  handleSettingsChange(
                    'strictness',
                    event.target.value as Settings['strictness'],
                  )
                }
              >
                {strictnessOptions.map((option) => (
                  <option key={option} value={option}>
                    {option.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Loading settings...</p>
        )}
        {!repository ? (
          <p className="mt-4 text-xs text-amber-700">
            Storage is still initializing. Settings will save once ready.
          </p>
        ) : null}
      </section>
    </main>
  );
}
