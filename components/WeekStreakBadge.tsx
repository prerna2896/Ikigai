'use client';

// Duolingo-style streak pill, lives in TopNav (every page) — see
// lib/useWeekStreak.ts for the "what counts," risk-level, and
// recovery logic. Deliberately quiet when there's no streak yet
// (renders nothing) rather than a shaming "0" — this app's voice is
// autonomy-supportive, not guilt-driven.
//
// Click opens a small detail popover: the streak count with a risk-
// appropriate message, a mini calendar-strip of recent weeks, the
// longest streak in the lookback window, and — if a recent week broke
// the streak — a "recover" card linking to that week so logging
// anything there heals it on the next recompute.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { WeekStreakResult } from '../lib/useWeekStreak';

// A single smooth flame shape (not the jagged two-path version this
// replaced) — calm/rounded rather than aggressive, matching the rest
// of this app's hand-drawn line-icon style when unlit (stroke-only)
// and filling in warm when lit, same visual language Duolingo itself
// uses for "today's already in the books."
function FlameIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

const RISK_STYLES: Record<string, { pill: string; icon: string }> = {
  safe: { pill: 'border-amber-200 bg-amber-50 text-amber-700', icon: 'text-amber-600' },
  pending: { pill: 'border-slate-200 text-mutedText', icon: 'text-mutedText' },
  urgent: { pill: 'border-rose-200 bg-rose-50 text-rose-700', icon: 'text-rose-600' },
};

function formatWeekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function riskMessage(streak: WeekStreakResult): string {
  switch (streak.riskLevel) {
    case 'safe':
      return 'This week already counts.';
    case 'urgent':
      return streak.daysLeftInWeek === 0
        ? 'Last day — log something today to keep it going.'
        : `${streak.daysLeftInWeek} day${streak.daysLeftInWeek === 1 ? '' : 's'} left — log something soon.`;
    case 'pending':
      return `${streak.daysLeftInWeek} days left this week to keep it going.`;
    default:
      return '';
  }
}

export default function WeekStreakBadge({ streak }: { streak: WeekStreakResult }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (streak.status === 'loading' || streak.riskLevel === 'none') return null;

  const style = RISK_STYLES[streak.riskLevel] ?? RISK_STYLES.pending;
  const lit = streak.riskLevel === 'safe';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="week-streak-badge"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${streak.count} week streak. ${riskMessage(streak)}`}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${style.pill}`}
      >
        <FlameIcon filled={lit} className={`h-4 w-4 shrink-0 ${style.icon}`} />
        <span data-testid="week-streak-count">{streak.count}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Streak details"
          data-testid="week-streak-popover"
          className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-slate-200 bg-surface p-4 text-sm shadow-lg"
        >
          <div className="flex items-center gap-2">
            <FlameIcon filled={lit} className={`h-6 w-6 shrink-0 ${style.icon}`} />
            <div>
              <p className="font-semibold text-text">
                {streak.count} week{streak.count === 1 ? '' : 's'} streak
              </p>
              <p className="text-xs text-mutedText">{riskMessage(streak)}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-1" data-testid="week-streak-history">
            {streak.recentWeeks.map((w) => (
              <span
                key={w.weekStartISO}
                title={w.weekStartISO}
                className={`h-5 flex-1 rounded-sm ${w.active ? 'bg-amber-400' : 'bg-slate-200'}`}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-mutedText">Last {streak.recentWeeks.length} weeks</p>

          <p className="mt-3 text-xs text-mutedText">
            Longest streak: <span className="font-medium text-text">{streak.longestStreak} weeks</span>
          </p>

          {streak.recoverable ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-900">Recover your streak</p>
              <p className="mt-1 text-xs text-amber-800">
                The week of {formatWeekStart(streak.recoverable.weekStartISO)} broke it. Log any hours for that
                week and it&apos;ll be restored.
              </p>
              <Link
                href={`/week/${streak.recoverable.weekStartISO}`}
                data-testid="week-streak-recover-link"
                className="mt-2 inline-flex items-center justify-center rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => setOpen(false)}
              >
                Go to that week
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
