'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  computeWeeklyCapacity,
  getBufferPercentForStrictness,
  type Settings,
} from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';

const STRICTNESS_OPTIONS: Array<{
  value: Settings['strictness'];
  label: string;
}> = [
  { value: 'no_buffer', label: 'No buffer' },
  { value: 'very_structured', label: 'Very structured' },
  { value: 'structured', label: 'Structured' },
  { value: 'somewhat_flexible', label: 'Somewhat flexible' },
  { value: 'very_flexible', label: 'Very flexible' },
];

type CapacityCardProps = {
  settings: Settings;
  plannedTaskHours: number;
  onSettingsChange: (next: Settings) => void;
};

export default function CapacityCard({
  settings,
  plannedTaskHours,
  onSettingsChange,
}: CapacityCardProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const derived = useMemo(
    () =>
      computeWeeklyCapacity({
        sleepHoursPerDay: settings.sleepHoursPerDay,
        maintenanceHoursPerDay: settings.maintenanceHoursPerDay,
        jobHoursPerWeek: settings.jobHoursPerWeek,
        classHoursPerWeek: settings.classHoursPerWeek,
        bufferPercent: getBufferPercentForStrictness(settings.strictness),
      }),
    [settings],
  );

  const strictness = settings.strictness;
  const bufferPercent = getBufferPercentForStrictness(strictness);
  const weeklyCapacityHours = derived.estimatedPlanForHours;
  const hoursLeft = Math.max(
    0,
    Math.round(weeklyCapacityHours - plannedTaskHours),
  );
  const overPlanned = plannedTaskHours > weeklyCapacityHours;

  const handleStrictnessChange = async (
    newStrictness: Settings['strictness'],
  ) => {
    if (newStrictness === settings.strictness) return;
    try {
      setStatus(null);
      const repo = getLocalRepository();
      const newDerived = computeWeeklyCapacity({
        sleepHoursPerDay: settings.sleepHoursPerDay,
        maintenanceHoursPerDay: settings.maintenanceHoursPerDay,
        jobHoursPerWeek: settings.jobHoursPerWeek,
        classHoursPerWeek: settings.classHoursPerWeek,
        bufferPercent: getBufferPercentForStrictness(newStrictness),
      });
      const next: Settings = {
        ...settings,
        strictness: newStrictness,
        bufferPercent: getBufferPercentForStrictness(newStrictness),
        weeklyCapacityHours: newDerived.estimatedPlanForHours,
        weeklyCapacityHoursDerived: newDerived.estimatedPlanForHours,
        updatedAt: new Date().toISOString(),
      };
      await repo.saveSettings(next);
      onSettingsChange(next);
      setStatus('Saved.');
      window.setTimeout(() => setStatus(null), 1500);
    } catch (error) {
      setStatus(String(error));
    }
  };

  const referenceFilled = derived.referenceFilledHours;
  const constantParts: string[] = [];
  if (derived.sleepHoursWeek > 0) {
    constantParts.push(`Sleep ${derived.sleepHoursWeek}h`);
  }
  if (derived.maintenanceHoursWeek > 0) {
    constantParts.push(`Maintenance ${derived.maintenanceHoursWeek}h`);
  }
  if (derived.commitmentsHoursWeek > 0) {
    constantParts.push(`Job + classes ${derived.commitmentsHoursWeek}h`);
  }

  return (
    <details
      className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm"
      data-testid="capacity-card"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex flex-wrap items-center gap-x-2 text-text">
          <span className="font-medium">Capacity</span>
          <span className="text-mutedText">
            · {weeklyCapacityHours}h ({bufferPercent}% buffer) ·{' '}
            <span className="text-text">{hoursLeft}h left</span>
          </span>
        </span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className={`h-3.5 w-3.5 text-mutedText transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </summary>

      <div className="mt-4 space-y-4 text-sm">
        <label className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-[0.18em] text-mutedText">
            Buffer
          </span>
          <select
            value={strictness}
            onChange={(event) =>
              void handleStrictnessChange(
                event.target.value as Settings['strictness'],
              )
            }
            data-testid="capacity-strictness"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
          >
            {STRICTNESS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {getBufferPercentForStrictness(option.value)}%
              </option>
            ))}
          </select>
          {status ? (
            <span className="text-xs text-mutedText" aria-live="polite">
              {status}
            </span>
          ) : null}
        </label>

        <dl className="rounded-xl border border-slate-200 bg-bg/40 p-3 text-sm">
          <Row label="Total" value={`${derived.totalWeekHours}h`} />
          <Row
            label={`Buffer (${bufferPercent}%)`}
            value={`-${derived.bufferHours}h`}
          />
          <Row
            label="Hours to plan"
            value={`${weeklyCapacityHours}h`}
            emphasis
          />
          {plannedTaskHours > 0 ? (
            <Row
              label="Already planned"
              value={`-${Math.round(plannedTaskHours)}h`}
            />
          ) : null}
          <Row
            label="Left to plan"
            value={`${hoursLeft}h`}
            emphasis
          />
        </dl>

        {constantParts.length > 0 ? (
          <p className="text-xs text-mutedText">
            <span className="font-medium uppercase tracking-[0.16em]">
              Constants
            </span>{' '}
            · {constantParts.join(' · ')} ({referenceFilled}h). Suggestions
            only — not deducted.
          </p>
        ) : null}

        {overPlanned ? (
          <p className="text-xs text-amber-800">
            You’ve planned {Math.round(plannedTaskHours)}h, more than the{' '}
            {weeklyCapacityHours}h target.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-0.5 ${
        emphasis ? 'font-medium text-text' : 'text-mutedText'
      }`}
    >
      <dt>{label}</dt>
      <dd className={emphasis ? 'text-text' : 'text-mutedText'}>{value}</dd>
    </div>
  );
}
