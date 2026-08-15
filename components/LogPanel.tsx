'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../lib/errors';
import { useStashedField } from '../lib/useStashedField';
import { StashRestoreBanner } from './StashRestoreBanner';
import {
  IKIGAI_PRINCIPLE_LABEL,
  IKIGAI_PRINCIPLE_IDS,
  suggestPrincipleForName,
  type IkigaiPrincipleId,
  type WeekLogEntry,
  type WeekPlan,
} from '@ikigai/core';
import { addDomainToPlan, withDerivedPlannedHours } from '../app/week/plan/planUtils';
import { CrystalIkigai } from './CrystalIkigai';
import IkigaiPrinciplesPlot from './IkigaiPrinciplesPlot';
import { useTheme } from './ThemeProvider';
import WeekGoals from './WeekGoals';
import { getDomainIcon } from '../lib/domainIcons';
import { useRepository } from './RepositoryProvider';

type LogFormState = Record<string, string>;

const formatHoursInput = (value: string) =>
  value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');

const parseHours = (value: string) => {
  const cleaned = formatHoursInput(value);
  if (cleaned === '') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};


type LogPanelProps = {
  weekPlan: WeekPlan;
  onPlanChange?: (next: WeekPlan) => void;
  onLogSaved?: () => void;
  variant?: 'standalone' | 'embedded';
};

export default function LogPanel({
  weekPlan,
  onPlanChange,
  onLogSaved,
  variant = 'standalone',
}: LogPanelProps) {
  const { theme } = useTheme();
  const { weekPlanRepo, weekLogRepo } = useRepository();
  const [plan, setPlan] = useState<WeekPlan>(weekPlan);
  const [weekLogs, setWeekLogs] = useState<WeekLogEntry[]>([]);
  const [logForm, setLogForm] = useState<LogFormState>({});
  const [plotMode, setPlotMode] = useState<'domains' | 'ikigai'>('domains');
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [selectedPrincipleId, setSelectedPrincipleId] =
    useState<IkigaiPrincipleId | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stash the in-progress unplanned-task title across reloads/re-auth.
  // Proof-of-concept for the form-stash pattern: if a session expires
  // while a user is typing here, they can sign back in and their draft
  // is still there. Namespace the key with the plan id so switching
  // between weeks doesn't cross-pollinate drafts. The hook exposes a
  // pendingRestore so we can prompt the user via <StashRestoreBanner>
  // instead of silently auto-filling.
  const stashKey = `logPanel.unplannedTitle:${weekPlan.id}`;
  const {
    value: unplannedTitle,
    setValue: setUnplannedTitle,
    pendingRestore: unplannedTitleRestore,
    restore: restoreUnplannedTitle,
    discard: discardUnplannedTitle,
    clear: clearUnplannedTitle,
  } = useStashedField<string>(stashKey, '');
  const [unplannedHours, setUnplannedHours] = useState('1');
  const [unplannedDomainId, setUnplannedDomainId] = useState<string | null>(
    weekPlan.domains[0]?.id ?? null,
  );
  const [unplannedTasks, setUnplannedTasks] = useState<
    { title: string; hours: number; domainId: string }[]
  >([]);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainPrincipleId, setNewDomainPrincipleId] = useState<
    IkigaiPrincipleId | null
  >(null);

  useEffect(() => {
    setPlan(weekPlan);
    setUnplannedDomainId((prev) => prev ?? weekPlan.domains[0]?.id ?? null);
  }, [weekPlan]);

  useEffect(() => {
    if (!weekLogRepo) return;
    let cancelled = false;
    weekLogRepo
      .getWeekLogs(plan.id)
      .then((logs) => {
        if (cancelled) return;
        const ordered = [...logs].sort((a, b) =>
          a.dateISO < b.dateISO ? 1 : -1,
        );
        setWeekLogs(ordered);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id, weekLogRepo]);

  const tasksForLog = useMemo(
    () =>
      plan.domains
        .flatMap((domain) =>
          domain.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            plannedHours: task.plannedHours,
            domainName: domain.name,
            completedAt: task.completedAt ?? null,
          })),
        )
        .sort((a, b) => b.plannedHours - a.plannedHours),
    [plan],
  );

  // Toggle a task's completed_at in one round-trip through the repo.
  // Deliberately NOT batched with the Save-log flow — the checkbox is
  // a discrete affordance and users expect immediate persistence, same
  // as the WeekGoals done toggle.
  const handleToggleDone = async (taskId: string) => {
    if (!weekPlanRepo) return;
    const nowIso = new Date().toISOString();
    const nextPlan: WeekPlan = {
      ...plan,
      domains: plan.domains.map((domain) => ({
        ...domain,
        tasks: domain.tasks.map((task) =>
          task.id === taskId
            ? { ...task, completedAt: task.completedAt ? null : nowIso }
            : task,
        ),
      })),
    };
    // Optimistic — bubble to the parent SYNCHRONOUSLY before await so
    // a mid-flight realtime refetch on cloudVersion doesn't hand us
    // back a stale weekPlan (without the toggle) and clobber the
    // optimistic state via the effect on line 89-92 that syncs
    // `plan` from the `weekPlan` prop. Previously the toggle would
    // flash on and revert half a second later — that was the race.
    setPlan(nextPlan);
    onPlanChange?.(nextPlan);
    try {
      await weekPlanRepo.saveWeekPlan(nextPlan);
    } catch (err) {
      setError(errorMessage(err));
      setPlan(plan);
      onPlanChange?.(plan);
    }
  };

  const weekTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    weekLogs.forEach((log) => {
      Object.entries(log.taskHours).forEach(([taskId, hours]) => {
        totals[taskId] = (totals[taskId] || 0) + hours;
      });
    });
    return totals;
  }, [weekLogs]);

  const crystalDomains = useMemo(
    () =>
      plan.domains.map((domain) => ({
        id: domain.id,
        name: domain.name,
        target: domain.plannedHours || 0,
        completed: domain.tasks.reduce(
          (sum, task) => sum + (weekTotals[task.id] || 0),
          0,
        ),
      })),
    [plan, weekTotals],
  );
  const hasTasks = plan.domains.some((d) => d.tasks.length > 0);

  const lastLog = weekLogs[0] ?? null;
  const lastLogDate = lastLog
    ? new Date(lastLog.dateISO).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : null;
  const lastLogTotal = lastLog
    ? Object.values(lastLog.taskHours).reduce((sum, h) => sum + h, 0)
    : 0;

  const totalPlannedHours = useMemo(
    () =>
      tasksForLog.reduce((sum, task) => sum + (task.plannedHours || 0), 0),
    [tasksForLog],
  );
  const totalCompletedHours = useMemo(
    () => Object.values(weekTotals).reduce((sum, h) => sum + h, 0),
    [weekTotals],
  );
  const hoursLeftToLog = Math.max(
    0,
    Math.round(totalPlannedHours - totalCompletedHours),
  );

  const handleLogChange = (taskId: string, value: string) => {
    setLogForm((prev) => ({ ...prev, [taskId]: formatHoursInput(value) }));
  };

  const handleAddUnplannedTask = () => {
    const title = unplannedTitle.trim();
    const hours = parseHours(unplannedHours);
    if (!title || hours <= 0 || !unplannedDomainId) return;
    setUnplannedTasks((prev) => [
      ...prev,
      { title, hours, domainId: unplannedDomainId },
    ]);
    setUnplannedTitle('');
    setUnplannedHours('1');
  };

  const handleAddUnplannedDomain = async () => {
    const trimmed = newDomainName.trim();
    if (!trimmed || plan.domains.length >= 12) return;
    if (!weekPlanRepo) return;
    try {
      const principle =
        newDomainPrincipleId ?? suggestPrincipleForName(trimmed);
      const { plan: nextPlan, domain } = addDomainToPlan(
        plan,
        trimmed,
        principle,
      );
      const normalized = withDerivedPlannedHours(nextPlan);
      await weekPlanRepo.saveWeekPlan(normalized);
      setPlan(normalized);
      onPlanChange?.(normalized);
      setUnplannedDomainId(domain.id);
      setNewDomainName('');
      setNewDomainPrincipleId(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleSaveLog = async () => {
    if (!weekPlanRepo || !weekLogRepo) return;
    try {
      setIsSaving(true);
      setError(null);
      const nowIso = new Date().toISOString();
      const taskHours: Record<string, number> = {};
      tasksForLog.forEach((task) => {
        const raw = logForm[task.id] ?? '';
        if (raw !== '') {
          taskHours[task.id] = parseHours(raw);
        }
      });
      // Auto-include any pending unplanned entry without requiring "Add unplanned" click first
      const pendingTitle = unplannedTitle.trim();
      const pendingHours = parseHours(unplannedHours);
      const effectiveUnplanned =
        pendingTitle && pendingHours > 0 && unplannedDomainId
          ? [...unplannedTasks, { title: pendingTitle, hours: pendingHours, domainId: unplannedDomainId }]
          : unplannedTasks;
      let workingPlan = plan;
      let planChanged = false;
      if (effectiveUnplanned.length > 0) {
        const newTasks = effectiveUnplanned.map((task) => ({
          id: crypto.randomUUID(),
          title: task.title,
          plannedHours: 0,
          domainId: task.domainId,
          hours: task.hours,
        }));
        const mergedPlan = {
          ...plan,
          domains: plan.domains.map((domain) => {
            const additions = newTasks
              .filter((task) => task.domainId === domain.id)
              .map((task) => ({
                id: task.id,
                title: task.title,
                plannedHours: 0,
              }));
            if (additions.length === 0) return domain;
            return { ...domain, tasks: [...domain.tasks, ...additions] };
          }),
          createdAtISO: plan.createdAtISO ?? nowIso,
        };
        newTasks.forEach((task) => {
          taskHours[task.id] = task.hours;
        });
        workingPlan = withDerivedPlannedHours(mergedPlan);
        await weekPlanRepo.saveWeekPlan(workingPlan);
        planChanged = true;
      }
      if (Object.keys(taskHours).length === 0) {
        setError('Add at least one number before saving.');
        return;
      }
      const entry: WeekLogEntry = {
        id: crypto.randomUUID(),
        weekId: workingPlan.id,
        dateISO: nowIso,
        taskHours,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await weekLogRepo.saveWeekLog(entry);
      const refreshed = await weekLogRepo.getWeekLogs(workingPlan.id);
      const ordered = [...refreshed].sort((a, b) =>
        a.dateISO < b.dateISO ? 1 : -1,
      );
      // Batch all UI-visible state updates together so the new task
      // appears in the list at the same instant its logged hours do —
      // otherwise the row flashes briefly as "0h logged" between the
      // saveWeekPlan re-render and the getWeekLogs refresh.
      if (planChanged) {
        setPlan(workingPlan);
        onPlanChange?.(workingPlan);
      }
      setWeekLogs(ordered);
      setLogForm({});
      setUnplannedTasks([]);
      setUnplannedTitle('');
      // Successful save = the draft is now recorded, clear the stash
      // so we don't offer a stale restore banner next mount.
      clearUnplannedTitle();
      setUnplannedHours('1');
      setStatus('Logged.');
      onLogSaved?.();
      window.setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const containerClass =
    variant === 'embedded'
      ? 'space-y-4'
      : 'rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm space-y-4';

  return (
    <section className={containerClass} data-testid="log-panel">
      <WeekGoals
        plan={plan}
        mode="checklist"
        onPlanChange={(next) => {
          setPlan(next);
          onPlanChange?.(next);
        }}
      />

      {hasTasks ? (
        <div className="space-y-3" data-testid="log-plot">
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1 text-xs text-mutedText">
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  plotMode === 'domains'
                    ? 'bg-accent text-white'
                    : 'text-mutedText'
                }`}
                onClick={() => setPlotMode('domains')}
              >
                Domains
              </button>
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  plotMode === 'ikigai'
                    ? 'bg-accent text-white'
                    : 'text-mutedText'
                }`}
                onClick={() => setPlotMode('ikigai')}
              >
                Ikigai
              </button>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[440px]">
            {plotMode === 'domains' ? (
              <CrystalIkigai
                variant={theme}
                domains={crystalDomains}
                showSkeleton={!hasTasks}
                activeDomainId={selectedDomainId}
                onSelectDomain={(domainId) => {
                  setSelectedPrincipleId(null);
                  setSelectedDomainId(domainId);
                }}
              />
            ) : (
              <IkigaiPrinciplesPlot
                domains={plan.domains}
                taskCompletedHours={weekTotals}
                activePrincipleId={selectedPrincipleId}
                onSelectPrinciple={(principleId) => {
                  setSelectedDomainId(null);
                  setSelectedPrincipleId(principleId);
                }}
              />
            )}
          </div>
        </div>
      ) : null}

      <div className="flex items-baseline justify-between gap-3">
        <div className="space-y-1">
          {lastLogDate ? (
            <p className="text-xs text-mutedText">
              Last entry: {lastLogDate} · {Math.round(lastLogTotal)}h logged
            </p>
          ) : (
            <p className="text-xs text-mutedText">No entries yet this week.</p>
          )}
        </div>
        {status ? (
          <span className="text-xs text-mutedText" aria-live="polite">
            {status}
          </span>
        ) : null}
      </div>

      {totalPlannedHours > 0 ? (
        <div
          className="rounded-xl border border-slate-200 bg-bg/40 p-3 text-xs text-mutedText"
          data-testid="log-summary"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span>
              <span className="font-medium uppercase tracking-[0.16em]">
                This week
              </span>{' '}
              · {Math.round(totalCompletedHours)}h of{' '}
              {Math.round(totalPlannedHours)}h logged
            </span>
            <span className="font-medium text-text">
              {hoursLeftToLog}h left
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
        >
          {error}
        </div>
      ) : null}

      {tasksForLog.length === 0 ? (
        <p className="text-sm text-mutedText">
          This plan has no tasks yet. Open the plan to add some.
        </p>
      ) : (
        <div className="space-y-2">
          {tasksForLog.map((task) => {
            const completed = Math.round(weekTotals[task.id] || 0);
            const planned = Math.round(task.plannedHours || 0);
            const left = Math.max(0, planned - completed);
            const markedDone = Boolean(task.completedAt);
            // The ✓ toggle is a first-class "done" signal independent of
            // hours logged (a task can be complete without being
            // time-tracked). Treat toggled-done as full green so the
            // left bar reads as done at a glance.
            const isDone = markedDone || (planned > 0 && completed >= planned);
            const hoursPct = planned > 0 ? Math.min(100, Math.round((completed / planned) * 100)) : 0;
            const fillPct = markedDone ? 100 : hoursPct;
            return (
              <div
                key={task.id}
                className="flex overflow-hidden rounded-xl border border-slate-200 text-sm text-text"
              >
                <div
                  className="w-1.5 shrink-0"
                  style={{
                    background: fillPct === 0
                      ? '#e2e8f0'
                      : `linear-gradient(to top, ${isDone ? '#22c55e' : '#fbbf24'} ${fillPct}%, #e2e8f0 ${fillPct}%)`
                  }}
                />
                {/* Reduced gap-3 → gap-2 and w-8 icon → w-7 to reclaim
                    the ~15px the ✓ button needed on mobile without
                    truncating longer task titles like "Dentist
                    appointment". Input dropped to w-14 too. */}
                <div className="flex flex-1 items-center gap-2 px-3 py-2">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-sm"
                  title={task.domainName}
                  aria-label={task.domainName}
                >
                  {getDomainIcon(task.domainName)}
                </span>
                <p
                  className={`min-w-0 flex-1 truncate font-medium ${
                    task.completedAt ? 'text-mutedText line-through' : ''
                  }`}
                >
                  {task.title}
                </p>
                <div className="flex shrink-0 flex-col items-end leading-tight">
                  {planned > 0 ? (
                    <>
                      <span
                        className={`text-sm font-semibold ${
                          isDone ? 'text-accent' : 'text-text'
                        }`}
                      >
                        {completed}h / {planned}h
                      </span>
                      <span className="text-[11px] text-mutedText">
                        {isDone ? 'all done' : `${left}h left`}
                      </span>
                    </>
                  ) : (
                    // Unplanned tasks: match the planned-task footprint
                    // ("Xh / Yh" is ~40px wide) instead of the older
                    // longer "Xh logged" (~60px) which squeezed the
                    // title + done button on narrow screens.
                    <span
                      className={`text-sm font-semibold ${
                        completed > 0 ? 'text-accent' : 'text-text'
                      }`}
                    >
                      {completed}h
                    </span>
                  )}
                </div>
                <label className="sr-only" htmlFor={`log-${task.id}`}>
                  Hours for {task.title}
                </label>
                <input
                  id={`log-${task.id}`}
                  type="text"
                  inputMode="numeric"
                  className="w-14 shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                  value={logForm[task.id] ?? ''}
                  onChange={(event) =>
                    handleLogChange(task.id, event.target.value)
                  }
                  placeholder="+0"
                />
                {/* Mark task done in one tap — independent of hours logged.
                    A user can check this without entering any hours (e.g.
                    task complete but not time-tracked) or entering hours
                    but not checking (e.g. logged some progress, not done
                    yet). Persists immediately via handleToggleDone. */}
                <button
                  type="button"
                  aria-label={
                    task.completedAt ? 'Mark as not done' : 'Mark as done'
                  }
                  aria-pressed={Boolean(task.completedAt)}
                  data-testid={`log-task-done-${task.id}`}
                  onClick={() => handleToggleDone(task.id)}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    task.completedAt
                      ? 'border-accent bg-accent text-white'
                      : 'border-slate-300 bg-white text-transparent hover:border-accent/60'
                  }`}
                >
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 8l3.5 3.5L13 5" />
                  </svg>
                </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-mutedText">
        <p className="text-sm font-medium text-text">Log something unplanned</p>
        <p className="mt-1">Add completed tasks that weren’t on the plan.</p>
        {unplannedTasks.length > 0 ? (
          <div className="mt-3 space-y-2">
            {unplannedTasks.map((task, index) => {
              const domainName =
                plan.domains.find((domain) => domain.id === task.domainId)
                  ?.name ?? 'Domain';
              return (
                <div
                  key={`${task.title}-${index}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="text-text">{task.title}</span>
                  <span>
                    {task.hours}h · {domainName}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {unplannedTitleRestore !== null ? (
          <div className="mt-3">
            <StashRestoreBanner
              onRestore={restoreUnplannedTitle}
              onDiscard={discardUnplannedTitle}
            />
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="text"
            className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
            value={unplannedTitle}
            onChange={(event) => setUnplannedTitle(event.target.value)}
            placeholder="Task name"
          />
          <input
            type="text"
            inputMode="numeric"
            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
            value={unplannedHours}
            onChange={(event) =>
              setUnplannedHours(formatHoursInput(event.target.value))
            }
            placeholder="Hours"
          />
          <select
            className="min-w-[160px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-text"
            value={unplannedDomainId ?? ''}
            onChange={(event) => setUnplannedDomainId(event.target.value)}
          >
            {plan.domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-text"
            onClick={handleAddUnplannedTask}
          >
            Add unplanned
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="text"
            className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
            value={newDomainName}
            onChange={(event) => setNewDomainName(event.target.value)}
            placeholder="New domain name"
          />
          <select
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-text"
            value={
              newDomainPrincipleId ??
              suggestPrincipleForName(newDomainName.trim() || 'general')
            }
            onChange={(event) =>
              setNewDomainPrincipleId(event.target.value as IkigaiPrincipleId)
            }
            aria-label="Principle for new domain"
          >
            {IKIGAI_PRINCIPLE_IDS.map((id) => (
              <option key={id} value={id}>
                {IKIGAI_PRINCIPLE_LABEL[id]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-text disabled:opacity-60"
            onClick={() => void handleAddUnplannedDomain()}
            disabled={plan.domains.length >= 12}
          >
            Add domain
          </button>
          {plan.domains.length >= 12 ? (
            <span className="text-[11px]">Max 12 domains</span>
          ) : null}
        </div>
        <p className="mt-2 text-[11px]">Save log records everything at once.</p>
      </div>

      <button
        type="button"
        className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        onClick={handleSaveLog}
        disabled={isSaving || tasksForLog.length === 0}
      >
        {isSaving ? 'Saving…' : 'Save log'}
      </button>

    </section>
  );
}
