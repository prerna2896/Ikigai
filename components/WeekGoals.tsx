'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WeekGoal, WeekPlan } from '@ikigai/core';
import type { WeekPlanRepository } from '@ikigai/storage';
import { useRepository } from './RepositoryProvider';

const MAX_GOALS = 3;

const ensureGoals = (plan: WeekPlan): WeekGoal[] => plan.goals ?? [];

const persistGoals = async (
  repo: WeekPlanRepository,
  plan: WeekPlan,
  goals: WeekGoal[],
) => {
  const next: WeekPlan = { ...plan, goals };
  await repo.saveWeekPlan(next);
  return next;
};

type WeekGoalsProps = {
  plan: WeekPlan;
  mode: 'editor' | 'checklist';
  onPlanChange?: (next: WeekPlan) => void;
};

export default function WeekGoals({
  plan,
  mode,
  onPlanChange,
}: WeekGoalsProps) {
  const { weekPlanRepo } = useRepository();
  const [goals, setGoals] = useState<WeekGoal[]>(() => ensureGoals(plan));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGoals(ensureGoals(plan));
  }, [plan]);

  const completedCount = useMemo(
    () => goals.filter((g) => g.completedAt).length,
    [goals],
  );

  const commit = async (nextGoals: WeekGoal[]) => {
    setGoals(nextGoals);
    if (!weekPlanRepo) return;
    try {
      const nextPlan = await persistGoals(weekPlanRepo, plan, nextGoals);
      onPlanChange?.(nextPlan);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleAdd = () => {
    const text = draft.trim();
    if (!text) return;
    if (goals.length >= MAX_GOALS) return;
    const newGoal: WeekGoal = {
      id: crypto.randomUUID(),
      text,
      completedAt: null,
    };
    setDraft('');
    void commit([...goals, newGoal]);
  };

  const handleRemove = (id: string) => {
    void commit(goals.filter((g) => g.id !== id));
  };

  const handleEdit = (id: string, text: string) => {
    void commit(
      goals.map((g) => (g.id === id ? { ...g, text } : g)),
    );
  };

  const handleToggle = (id: string) => {
    const nowIso = new Date().toISOString();
    void commit(
      goals.map((g) =>
        g.id === id
          ? { ...g, completedAt: g.completedAt ? null : nowIso }
          : g,
      ),
    );
  };

  if (mode === 'checklist' && goals.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm"
      data-testid="week-goals"
      aria-labelledby="week-goals-heading"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2
            id="week-goals-heading"
            className="text-sm font-semibold text-text"
          >
            {mode === 'editor' ? 'Three goals for the week' : 'Goals for the week'}
          </h2>
          {mode === 'editor' ? (
            <p className="mt-1 text-xs text-mutedText">
              Tasks or focus areas — anything you want to point at this week.
              Up to {MAX_GOALS}.
            </p>
          ) : null}
        </div>
        {goals.length > 0 ? (
          <p className="text-xs text-mutedText" data-testid="week-goals-count">
            {completedCount}/{goals.length} done
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-rose-600">
          {error}
        </p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {goals.map((goal) => (
          <li
            key={goal.id}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
            data-testid="week-goal-row"
          >
            <button
              type="button"
              onClick={() => handleToggle(goal.id)}
              aria-label={
                goal.completedAt ? 'Mark as not done' : 'Mark as done'
              }
              aria-pressed={Boolean(goal.completedAt)}
              data-testid="week-goal-toggle"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                goal.completedAt
                  ? 'border-accent bg-accent text-white'
                  : 'border-slate-300 bg-white text-transparent hover:border-accent/60'
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 8l3.5 3.5L13 5" />
              </svg>
            </button>
            {mode === 'editor' ? (
              <input
                type="text"
                value={goal.text}
                onChange={(event) => handleEdit(goal.id, event.target.value)}
                className={`flex-1 bg-transparent text-sm focus:outline-none ${
                  goal.completedAt
                    ? 'text-mutedText line-through'
                    : 'text-text'
                }`}
                aria-label="Goal text"
              />
            ) : (
              <span
                className={`flex-1 text-sm ${
                  goal.completedAt ? 'text-mutedText line-through' : 'text-text'
                }`}
              >
                {goal.text}
              </span>
            )}
            {mode === 'editor' ? (
              <button
                type="button"
                onClick={() => handleRemove(goal.id)}
                aria-label="Remove goal"
                className="text-xs text-mutedText transition-colors hover:text-rose-700"
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {mode === 'editor' && goals.length < MAX_GOALS ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAdd();
              }
            }}
            placeholder={`Goal ${goals.length + 1} (e.g. ship the prototype)`}
            data-testid="week-goal-input"
            className="min-w-[180px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={draft.trim().length === 0}
            data-testid="week-goal-add"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-text disabled:opacity-60"
          >
            Add goal
          </button>
        </div>
      ) : null}

      {mode === 'editor' && goals.length === 0 ? (
        <p className="mt-2 text-xs text-mutedText">
          Skip these if nothing comes to mind — your week plan still works.
        </p>
      ) : null}
    </section>
  );
}
