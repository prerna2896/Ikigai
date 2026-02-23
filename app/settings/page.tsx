'use client';

import { useEffect, useState } from 'react';
import {
  computeWeeklyCapacity,
  getBufferPercentForStrictness,
  type Settings,
} from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import SettingsForm from '../../components/SettingsForm';

export default function SettingsPage() {
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      repo
        .getSettings()
        .then((record) => {
          setSettings(record);
        })
        .catch((error) => {
          setStatus(String(error));
        });
    } catch (error) {
      setStatus(String(error));
    }
  }, []);

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

  const handleSave = async () => {
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
    setStatus('Saved.');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Settings
        </p>
        <h1 className="text-3xl font-semibold text-text">Your weekly defaults</h1>
        <p className="text-sm text-mutedText">
          Gentle defaults that you can adjust whenever you need.
        </p>
        {status ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {status}
          </div>
        ) : null}
      </header>

      {settings ? (
        <SettingsForm
          settings={settings}
          onChange={handleSettingsChange}
          onSave={() => void handleSave()}
          saveLabel="Save changes"
          disabled={!repository}
        />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <p className="text-sm text-mutedText">Loading settings...</p>
        </section>
      )}
    </main>
  );
}
