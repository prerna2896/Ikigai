'use client';

import { getBufferPercentForStrictness, type Settings } from '@ikigai/core';

const strictnessOptions: Settings['strictness'][] = [
  'very_flexible',
  'somewhat_flexible',
  'structured',
  'very_structured',
];

type SettingsFormProps = {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onSave: () => void;
  saveLabel?: string;
  disabled?: boolean;
};

export default function SettingsForm({
  settings,
  onChange,
  onSave,
  saveLabel = 'Save changes',
  disabled = false,
}: SettingsFormProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-mutedText">
          Weekly planning capacity (hours)
          <input
            type="number"
            min={0}
            className="rounded-xl border border-slate-200 px-3 py-2 text-text"
            value={settings.weeklyCapacityHours}
            onChange={(event) =>
              onChange(
                'weeklyCapacityHours',
                Number(event.target.value.replace(/^0+(?=\\d)/, '')),
              )
            }
            onFocus={(event) => event.currentTarget.select()}
          />
          <span className="text-xs text-mutedText">Rough estimate is fine.</span>
        </label>
        <label className="flex flex-col gap-2 text-sm text-mutedText">
          Planning style
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-text"
            value={settings.strictness}
            onChange={(event) =>
              onChange('strictness', event.target.value as Settings['strictness'])
            }
          >
            {strictnessOptions.map((option) => (
              <option key={option} value={option}>
                {option.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-2 text-sm text-mutedText">
          Preferred tone
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-text">
            {settings.preferredTone
              ? settings.preferredTone.replace(/_/g, ' ')
              : 'Not set'}
          </div>
        </div>
        <div className="flex flex-col gap-2 text-sm text-mutedText">
          Planning buffer
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-text">
            {getBufferPercentForStrictness(settings.strictness)}%
          </div>
        </div>
        <label className="flex flex-col gap-2 text-sm text-mutedText">
          Sleep hours per day
          <input
            type="number"
            min={0}
            className="rounded-xl border border-slate-200 px-3 py-2 text-text"
            value={settings.sleepHoursPerDay}
            onChange={(event) =>
              onChange(
                'sleepHoursPerDay',
                Number(event.target.value.replace(/^0+(?=\\d)/, '')),
              )
            }
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-mutedText">
          Maintenance hours per day
          <input
            type="number"
            min={0}
            className="rounded-xl border border-slate-200 px-3 py-2 text-text"
            value={settings.maintenanceHoursPerDay}
            onChange={(event) =>
              onChange(
                'maintenanceHoursPerDay',
                Number(event.target.value.replace(/^0+(?=\\d)/, '')),
              )
            }
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-mutedText">
          Week starts on
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-text"
            value={settings.weekStartDay}
            onChange={(event) =>
              onChange('weekStartDay', event.target.value as Settings['weekStartDay'])
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
        <div className="flex flex-col gap-2 text-sm text-mutedText">
          Time zone
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-text">
            {settings.weekTimeZone}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#4f6e6a] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        onClick={onSave}
        disabled={disabled}
      >
        {saveLabel}
      </button>
    </section>
  );
}
