'use client';

// Duolingo-style streak pill, lives in TopNav (every page) — see
// lib/useWeekStreak.ts for the "what counts," risk-level, and
// recovery-limit logic. Deliberately quiet when there's no streak yet
// (renders nothing) rather than a shaming "0" — this app's voice is
// autonomy-supportive, not guilt-driven.
//
// Click opens a small detail popover: the streak count with a risk-
// appropriate message, a mini calendar-strip of recent weeks, the
// longest streak in the lookback window, and — if a recent week broke
// the streak and a recovery use is still available — a "Recover
// streak" action.

import { useEffect, useRef, useState } from 'react';
import type { WeekStreakResult } from '../lib/useWeekStreak';

// A single smooth flame shape (not the jagged two-path version this
// replaced) — calm/rounded rather than aggressive, matching the rest
// of this app's hand-drawn line-icon style when unlit (stroke-only)
// and filling in warm when lit, same visual language Duolingo itself
// uses for "today's already in the books."
function FlameIcon({ filled, className, style }: { filled: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

// "Safe" (lit) deliberately uses the active THEME's own accent color
// (var(--accent), the same CSS custom property ThemePicker's themes
// each set — see app/globals.css) rather than a fixed hue, so the
// flame matches whichever of the app's themes is active instead of
// clashing with it. Note: plain Tailwind utility classes like
// `text-accent`/`border-accent` do NOT work in this app — they aren't
// registered Tailwind colors or defined CSS classes here (only
// .bg-accent/.bg-accentSoft are real) — so this reads the CSS
// variable directly via inline style instead. "Urgent"/"pending" stay
// fixed semantic colors on purpose: a danger/neutral signal shouldn't
// reskin per theme the way a purely decorative "lit" state can — an
// urgent red that turned theme-teal wouldn't read as urgent anymore.
//
// Also deliberately avoids any `slate-*` utility (bg-slate-200,
// border-slate-200, etc.) here. tailwind.config.js registers a flat
// brand color under the key "slate" (for Domain.colorToken) which
// replaces Tailwind's entire built-in slate-50..950 scale rather than
// extending it — every `slate-<shade>` class app-wide silently
// compiles to nothing as a result. `border-themed` (globals.css,
// bound to var(--border)) is the working, theme-reactive substitute.
const RISK_STYLES: Record<string, { pill: string; usesThemeAccent?: boolean }> = {
  safe: { pill: 'border-themed bg-accentSoft', usesThemeAccent: true },
  pending: { pill: 'border-themed text-mutedText' },
  urgent: { pill: 'border-rose-200 bg-rose-50 text-rose-700' },
};

function formatWeekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function formatRecoveryDate(iso: string): string {
  const date = new Date(iso);
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

export default function WeekStreakBadge({
  streak,
  onRecover,
}: {
  streak: WeekStreakResult;
  // Records the recovery use (persists it, so the limit is consumed
  // the moment someone commits to recovering — not conditionally on
  // whether they actually go log hours afterward). Caller (TopNav)
  // owns the settings write; this component only triggers it and
  // then navigates.
  onRecover: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [recovering, setRecovering] = useState(false);
  // Captured at click time, not read from streak.recoverable after
  // the fact — the moment onRecover() resolves, TopNav's bumpSync()
  // triggers a recompute that heals the week and sets
  // streak.recoverable back to null, which would otherwise make this
  // confirmation unreachable (it rendered for literally zero frames
  // before the parent re-render wiped the data it depended on).
  const [recoveredWeekISO, setRecoveredWeekISO] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) setRecoveredWeekISO(null);
  }, [open]);

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
  const accentStyle = style.usesThemeAccent ? { color: 'var(--accent)' } : undefined;

  const handleRecover = async () => {
    if (!streak.recoverable || recovering) return;
    const weekISO = streak.recoverable.weekStartISO;
    setRecovering(true);
    try {
      // Heals in place — no navigation. Logging real hours for a week
      // someone may not remember anything about was too big an ask to
      // gate recovery on; the "Recovered" confirmation below is the
      // entire flow now.
      await onRecover();
      setRecoveredWeekISO(weekISO);
    } finally {
      setRecovering(false);
    }
  };

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
        style={accentStyle}
      >
        <FlameIcon filled={lit} className="h-4 w-4 shrink-0" style={accentStyle} />
        <span data-testid="week-streak-count">{streak.count}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Streak details"
          data-testid="week-streak-popover"
          className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-themed bg-surface p-4 text-sm shadow-lg"
        >
          <div className="flex items-center gap-2">
            <FlameIcon filled={lit} className="h-6 w-6 shrink-0" style={accentStyle} />
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
                title={`${formatWeekStart(w.weekStartISO)} — ${
                  w.recovered ? 'recovered' : w.active ? 'logged' : 'no activity'
                }`}
                className="h-5 flex-1 rounded-sm"
                style={
                  w.recovered
                    ? {
                        backgroundColor: 'var(--accentSoft)',
                        boxShadow: 'inset 0 0 0 1.5px var(--accent)',
                      }
                    : { backgroundColor: w.active ? 'var(--accent)' : 'var(--border-strong)' }
                }
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-mutedText">
            Last {streak.recentWeeks.length} weeks
            {streak.recentWeeks.some((w) => w.recovered) ? ' · outlined = recovered' : ''}
          </p>

          <p className="mt-3 text-xs text-mutedText">
            Longest streak: <span className="font-medium text-text">{streak.longestStreak} weeks</span>
          </p>

          {recoveredWeekISO ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p data-testid="week-streak-recovered-confirmation" className="text-xs font-medium text-emerald-900">
                Recovered — the week of {formatWeekStart(recoveredWeekISO)} is back in your streak.
              </p>
            </div>
          ) : streak.recoverable ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-900">Recover your streak</p>
              <p className="mt-1 text-xs text-amber-800">
                The week of {formatWeekStart(streak.recoverable.weekStartISO)} broke it. You don&apos;t need to
                remember or log anything from that week — recovering just marks it back in.
              </p>
              {streak.recoveryUsesRemaining > 0 ? (
                <button
                  type="button"
                  data-testid="week-streak-recover-button"
                  onClick={() => void handleRecover()}
                  disabled={recovering}
                  className="mt-2 inline-flex items-center justify-center rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {recovering ? 'Recovering…' : 'Recover streak'}
                </button>
              ) : streak.earnedRecoveries === 0 ? (
                <p data-testid="week-streak-recovery-exhausted" className="mt-2 text-[11px] text-amber-700">
                  Log some hours this week to earn a recovery.
                </p>
              ) : (
                <p data-testid="week-streak-recovery-exhausted" className="mt-2 text-[11px] text-amber-700">
                  You&apos;ve used the recoveries your recent logging earned.
                  {streak.nextRecoveryAvailableAt
                    ? ` Next one opens around ${formatRecoveryDate(streak.nextRecoveryAvailableAt)} — logging more could earn one sooner.`
                    : ''}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
