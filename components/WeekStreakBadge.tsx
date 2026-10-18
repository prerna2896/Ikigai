// Duolingo-style streak pill — see lib/useWeekStreak.ts for the
// "what counts" logic. Deliberately quiet when there's nothing to
// show yet (no streak) rather than displaying a shaming "0" — this
// app's voice is autonomy-supportive, not guilt-driven.

import type { WeekStreakResult } from '../lib/useWeekStreak';

function FlameIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden
    >
      <path d="M12 2c-1 3-4 4.5-4 8a4 4 0 0 0 8 0c0-1.2-.4-2-1-2.8.1 1-.3 1.8-1 2.3C14.6 7.8 13.5 5 12 2Z" />
      <path d="M8.5 14.5A3.5 3.5 0 0 0 12 18a3.5 3.5 0 0 0 3.5-3.5" />
    </svg>
  );
}

export default function WeekStreakBadge({ streak }: { streak: WeekStreakResult }) {
  if (streak.status === 'loading') return null;
  if (streak.count === 0) return null;

  return (
    <div
      data-testid="week-streak-badge"
      title={
        streak.isActiveThisWeek
          ? `${streak.count} week streak — this week already counts.`
          : `${streak.count} week streak — log something this week to keep it going.`
      }
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
        streak.isActiveThisWeek
          ? 'border-slate-200 bg-accentSoft text-text'
          : 'border-slate-200 text-mutedText'
      }`}
    >
      <FlameIcon active={streak.isActiveThisWeek} />
      <span data-testid="week-streak-count">{streak.count} week streak</span>
    </div>
  );
}
