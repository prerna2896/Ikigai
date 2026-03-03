'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DomainTask, Settings, WeekPlan } from '@ikigai/core';
import { getOpeningRemark, PROFESSION_COMMITMENT_LABELS } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import IkigaiWheelPlot from '../../../components/IkigaiWheelPlot';
import IkigaiPrinciplesPlot, {
  getPrincipleForDomain,
  type IkigaiPrincipleId,
} from '../../../components/IkigaiPrinciplesPlot';
import { PLAN_COPY } from './copy';
import {
  addDomainToPlan,
  applyDefaultDomainNames,
  createDefaultWeekPlan,
  flattenTasks,
  getWeekEndISO,
  getWeekStartISO,
  moveTaskToDomain,
  removeTaskFromPlan,
  suggestDomainForTask,
  updateTaskInPlan,
  withDerivedPlannedHours,
} from './planUtils';

const DOMAIN_OVERRIDE_KEY = 'ikigai_task_domain_overrides_v1';

const formatHoursInput = (value: string) =>
  value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');

const parseHours = (value: string, fallback: number) => {
  const cleaned = formatHoursInput(value);
  if (cleaned === '') {
    return fallback;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const makeNewDomainName = (plan: WeekPlan) => {
  const base = 'New domain';
  const existing = new Set(plan.domains.map((domain) => domain.name.toLowerCase()));
  if (!existing.has(base.toLowerCase())) {
    return base;
  }
  let index = 2;
  while (existing.has(`${base} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${base} ${index}`;
};

const normalizeTitle = (value: string) => value.trim().toLowerCase();

export default function WeekPlanPage() {
  const router = useRouter();
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [lastWeekPlan, setLastWeekPlan] = useState<WeekPlan | null>(null);
  const [lastWeekTotals, setLastWeekTotals] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskHours, setTaskHours] = useState('1');
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [domainPickerTaskId, setDomainPickerTaskId] = useState<string | null>(null);
  const [newDomainName, setNewDomainName] = useState('');
  const [domainOverrides, setDomainOverrides] = useState<Record<string, string>>({});
  const [plotMode, setPlotMode] = useState<'domains' | 'ikigai'>('domains');
  const [selectedPrincipleId, setSelectedPrincipleId] =
    useState<IkigaiPrincipleId | null>(null);

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      Promise.all([repo.getSettings(), repo.getProfile(), repo.listWeekPlans()])
        .then(async ([settingsRecord, profile, plans]) => {
          setSettings(settingsRecord);
          if (!profile) {
            router.replace('/onboarding/name');
            return;
          }
          const timeZone =
            settingsRecord.weekTimeZone ||
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            'UTC';
          const weekStartDay = settingsRecord.weekStartDay || 'sunday';
          const preferNextWeek = plans.length === 0;
          const weekStartISO = getWeekStartISO(
            new Date(),
            weekStartDay,
            preferNextWeek,
          );
          const weekEndISO = getWeekEndISO(weekStartISO);
          const sortedPlans = [...plans].sort((a, b) =>
            a.weekStartISO < b.weekStartISO ? 1 : -1,
          );
          const previousPlan = sortedPlans.find(
            (candidate) => candidate.weekStartISO !== weekStartISO,
          );
          const plan = await repo.getWeekPlan(weekStartISO);
          if (plan) {
            let normalized = applyDefaultDomainNames(plan);
            if (
              !normalized.weekEndISO ||
              !normalized.weekStartDay ||
              !normalized.weekTimeZone
            ) {
              normalized = {
                ...normalized,
                weekEndISO: normalized.weekEndISO || weekEndISO,
                weekStartDay: normalized.weekStartDay || weekStartDay,
                weekTimeZone: normalized.weekTimeZone || timeZone,
              };
            }
            if (normalized !== plan) {
              await repo.saveWeekPlan(normalized);
            }
            const derived = withDerivedPlannedHours(normalized);
            setWeekPlan(derived);
            setSelectedDomainId(null);
            setSidebarOpen(false);
            if (previousPlan) {
              const derivedPrevious = withDerivedPlannedHours(previousPlan);
              setLastWeekPlan(derivedPrevious);
              const previousLogs = await repo.getWeekLogs(previousPlan.id);
              const totals: Record<string, number> = {};
              previousLogs.forEach((log) => {
                Object.entries(log.taskHours).forEach(([taskId, hours]) => {
                  totals[taskId] = (totals[taskId] || 0) + hours;
                });
              });
              setLastWeekTotals(totals);
            } else {
              setLastWeekPlan(null);
              setLastWeekTotals({});
            }
            return;
          }
          const freshPlan = createDefaultWeekPlan(
            weekStartISO,
            weekEndISO,
            weekStartDay,
            timeZone,
          );
          await repo.saveWeekPlan(freshPlan);
          const derived = withDerivedPlannedHours(freshPlan);
          setWeekPlan(derived);
          setSelectedDomainId(null);
          setSidebarOpen(false);
          if (previousPlan) {
            const derivedPrevious = withDerivedPlannedHours(previousPlan);
            setLastWeekPlan(derivedPrevious);
            const previousLogs = await repo.getWeekLogs(previousPlan.id);
            const totals: Record<string, number> = {};
            previousLogs.forEach((log) => {
              Object.entries(log.taskHours).forEach(([taskId, hours]) => {
                totals[taskId] = (totals[taskId] || 0) + hours;
              });
            });
            setLastWeekTotals(totals);
          } else {
            setLastWeekPlan(null);
            setLastWeekTotals({});
          }
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DOMAIN_OVERRIDE_KEY);
      if (stored) {
        setDomainOverrides(JSON.parse(stored));
      }
    } catch (error) {
      setStatus(String(error));
    }
  }, []);

  const remark = useMemo(() => {
    if (!settings) {
      return null;
    }
    return getOpeningRemark({
      tone: settings.preferredTone,
      planningStyle: settings.strictness,
      bufferPercent: settings.bufferPercent,
    });
  }, [settings]);

  const weekRangeLabel = useMemo(() => {
    if (!weekPlan) {
      return null;
    }
    const timeZone =
      weekPlan.weekTimeZone ||
      settings?.weekTimeZone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      'UTC';
    const start = new Date(`${weekPlan.weekStartISO}T00:00:00`);
    const end = new Date(`${weekPlan.weekEndISO}T00:00:00`);
    const formatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone,
    });
    return `${formatter.format(start)} – ${formatter.format(end)}`;
  }, [weekPlan, settings]);

  const taskList = useMemo(() => {
    if (!weekPlan) {
      return [] as ReturnType<typeof flattenTasks>;
    }
    return flattenTasks(weekPlan.domains);
  }, [weekPlan]);

  const lastWeekTasks = useMemo(() => {
    if (!lastWeekPlan) {
      return [];
    }
    const tasks = lastWeekPlan.domains.flatMap((domain) =>
      domain.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        plannedHours: task.plannedHours,
        completedHours: lastWeekTotals[task.id] || 0,
        domainName: domain.name,
      })),
    );
    return tasks.sort((a, b) => b.plannedHours - a.plannedHours);
  }, [lastWeekPlan, lastWeekTotals]);

  const hasTasks = taskList.some((item) => item.task.plannedHours > 0);
  const largestDomain =
    weekPlan && weekPlan.domains.length > 0
      ? weekPlan.domains.reduce((current, domain) =>
          domain.plannedHours > current.plannedHours ? domain : current,
        )
      : null;

  const persistPlan = async (updated: WeekPlan, nextStatus?: string) => {
    if (!repository) {
      return;
    }
    await repository.saveWeekPlan(updated);
    setWeekPlan(withDerivedPlannedHours(updated));
    if (nextStatus) {
      setStatus(nextStatus);
      window.setTimeout(() => setStatus(null), 1500);
    }
  };

  const updatePlan = (updated: WeekPlan) => {
    setWeekPlan(withDerivedPlannedHours(updated));
  };

  const saveOverrides = (nextOverrides: Record<string, string>) => {
    setDomainOverrides(nextOverrides);
    try {
      window.localStorage.setItem(DOMAIN_OVERRIDE_KEY, JSON.stringify(nextOverrides));
    } catch (error) {
      setStatus(String(error));
    }
  };

  const findOverrideDomainId = (title: string) => {
    const normalized = normalizeTitle(title);
    if (!normalized) {
      return null;
    }
    const exact = domainOverrides[normalized];
    if (exact) {
      return exact;
    }
    for (const [key, domainId] of Object.entries(domainOverrides)) {
      if (normalized.includes(key)) {
        return domainId;
      }
    }
    return null;
  };

  const addTaskToPlan = async (
    title: string,
    hours: number,
    forcedDomainId?: string | null,
  ) => {
    if (!weekPlan || !repository) {
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const task: DomainTask = {
      id: crypto.randomUUID(),
      title: trimmed,
      plannedHours: hours,
    };

    let updatedPlan = weekPlan;
    const overrideDomainId = findOverrideDomainId(trimmed);
    let targetDomainId = forcedDomainId ?? overrideDomainId;
    if (
      targetDomainId &&
      !updatedPlan.domains.some((domain) => domain.id === targetDomainId)
    ) {
      targetDomainId = null;
    }

    if (!targetDomainId) {
      const suggestion = suggestDomainForTask(trimmed, updatedPlan.domains);
      targetDomainId = suggestion.domainId ?? null;

      if (!targetDomainId && suggestion.createName && updatedPlan.domains.length < 7) {
        const { plan, domain } = addDomainToPlan(updatedPlan, suggestion.createName);
        updatedPlan = plan;
        targetDomainId = domain.id;
      }
    }

    if (!targetDomainId) {
      const fallback = updatedPlan.domains[0];
      targetDomainId = fallback?.id ?? null;
      if (!targetDomainId) {
        const { plan, domain } = addDomainToPlan(updatedPlan, 'General');
        updatedPlan = plan;
        targetDomainId = domain.id;
      }
    }

    const domains = updatedPlan.domains.map((domain) =>
      domain.id === targetDomainId
        ? { ...domain, tasks: [...domain.tasks, task] }
        : domain,
    );
    updatedPlan = { ...updatedPlan, domains };

    await persistPlan(updatedPlan);
    setSelectedDomainId(targetDomainId);
  };

  const handleAddTask = async () => {
    const trimmed = taskTitle.trim();
    if (!trimmed) {
      return;
    }
    const hours = parseHours(taskHours, 1);
    await addTaskToPlan(trimmed, hours);
    setTaskTitle('');
    setTaskHours('1');
  };

  const handleAddDomain = async () => {
    if (!repository || !weekPlan || weekPlan.domains.length >= 7) {
      return;
    }
    const name = makeNewDomainName(weekPlan);
    const { plan } = addDomainToPlan(weekPlan, name);
    await persistPlan(plan);
  };

  const handleAssignTaskDomain = async (
    taskId: string,
    currentDomainId: string,
    nextDomainId: string,
  ) => {
    if (!weekPlan) {
      return;
    }
    const updated = moveTaskToDomain(weekPlan, taskId, currentDomainId, nextDomainId);
    await persistPlan(updated);
    const target = taskList.find((item) => item.task.id === taskId);
    if (target) {
      const normalized = normalizeTitle(target.task.title);
      if (normalized) {
        saveOverrides({ ...domainOverrides, [normalized]: nextDomainId });
      }
    }
    setDomainPickerTaskId(null);
    setSelectedDomainId(nextDomainId);
  };

  const handleCreateDomainForTask = async (
    taskId: string,
    currentDomainId: string,
  ) => {
    if (!weekPlan || !newDomainName.trim() || weekPlan.domains.length >= 7) {
      return;
    }
    const { plan, domain } = addDomainToPlan(weekPlan, newDomainName.trim());
    const updated = moveTaskToDomain(plan, taskId, currentDomainId, domain.id);
    await persistPlan(updated);
    setNewDomainName('');
    setDomainPickerTaskId(null);
    setSelectedDomainId(domain.id);
  };

  const handleTaskFieldChange = (
    domainId: string,
    taskId: string,
    updates: Partial<DomainTask>,
    persist = false,
  ) => {
    if (!weekPlan) {
      return;
    }
    const updated = updateTaskInPlan(weekPlan, domainId, taskId, updates);
    updatePlan(updated);
    if (persist) {
      void persistPlan(updated);
    }
  };

  const handleRemoveTask = (domainId: string, taskId: string) => {
    if (!weekPlan) {
      return;
    }
    const updated = removeTaskFromPlan(weekPlan, domainId, taskId);
    void persistPlan(updated);
  };

  const handleCompletePlanning = () => {
    if (!weekPlan) {
      return;
    }
    void persistPlan({ ...weekPlan, isFrozen: true }, PLAN_COPY.saveStatus);
  };

  const handleReopenPlanning = () => {
    if (!weekPlan) {
      return;
    }
    void persistPlan({ ...weekPlan, isFrozen: false });
  };

  const selectedDomain = weekPlan?.domains.find(
    (domain) => domain.id === selectedDomainId,
  );

  const planningComplete = Boolean(weekPlan?.isFrozen);

  const getDomainIdByName = (name: string) =>
    weekPlan?.domains.find(
      (domain) => domain.name.toLowerCase() === name.toLowerCase(),
    )?.id ?? null;

  const maintenanceHours = settings
    ? Math.round(settings.maintenanceHoursPerDay * 7)
    : 0;
  const sleepHours = settings ? Math.round(settings.sleepHoursPerDay * 7) : 0;
  const commitmentsHours = settings
    ? Math.round(settings.jobHoursPerWeek + settings.classHoursPerWeek)
    : 0;
  const commitmentsLabel = settings
    ? (() => {
        const base = PROFESSION_COMMITMENT_LABELS[settings.professionType];
        if (settings.hasJob && settings.isStudent) {
          return 'Work & school';
        }
        if (settings.isStudent) {
          return 'School';
        }
        if (settings.hasJob) {
          return 'Work';
        }
        return base;
      })()
    : PLAN_COPY.quickTaskCommitments;

  const plannedTaskHours = useMemo(() => {
    if (!taskList.length) {
      return 0;
    }
    return taskList.reduce((sum, item) => {
      return sum + (item.task.plannedHours || 0);
    }, 0);
  }, [taskList]);

  const planningCapacityHours = settings ? settings.weeklyCapacityHours : null;

  const planningHoursLeft =
    planningCapacityHours !== null
      ? Math.max(0, planningCapacityHours - plannedTaskHours)
      : null;

  const plotToggle = (
    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1 text-xs text-mutedText">
      <button
        type="button"
        className={`rounded-full px-3 py-1 text-xs font-medium ${
          plotMode === 'domains' ? 'bg-accent text-white' : 'text-mutedText'
        }`}
        onClick={() => {
          setPlotMode('domains');
          setSelectedPrincipleId(null);
        }}
      >
        Domains
      </button>
      <button
        type="button"
        className={`rounded-full px-3 py-1 text-xs font-medium ${
          plotMode === 'ikigai' ? 'bg-accent text-white' : 'text-mutedText'
        }`}
        onClick={() => {
          setPlotMode('ikigai');
          setSelectedDomainId(null);
        }}
      >
        Ikigai
      </button>
    </div>
  );

  const principleTotals = useMemo(() => {
    if (!weekPlan) {
      return [] as { id: IkigaiPrincipleId; label: string; hours: number }[];
    }
    const base: Record<IkigaiPrincipleId, number> = {
      energy: 0,
      growth: 0,
      contribution: 0,
      alignment: 0,
    };
    weekPlan.domains.forEach((domain) => {
      const principle = getPrincipleForDomain(domain.name);
      base[principle] += domain.plannedHours || 0;
    });
    return [
      { id: 'energy', label: 'Energy', hours: base.energy },
      { id: 'growth', label: 'Growth', hours: base.growth },
      { id: 'contribution', label: 'Contribution', hours: base.contribution },
      { id: 'alignment', label: 'Alignment', hours: base.alignment },
    ];
  }, [weekPlan]);

  const principleTasks = useMemo(() => {
    if (!weekPlan || !selectedPrincipleId) {
      return [] as { id: string; title: string; hours: number; domainName: string }[];
    }
    const tasks = weekPlan.domains.flatMap((domain) =>
      getPrincipleForDomain(domain.name) === selectedPrincipleId
        ? domain.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            hours: task.plannedHours,
            domainName: domain.name,
          }))
        : [],
    );
    return tasks.sort((a, b) => b.hours - a.hours);
  }, [weekPlan, selectedPrincipleId]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="inline-flex items-center gap-2 text-xs text-mutedText hover:text-text"
            onClick={() => router.push('/onboarding/settings?step=3')}
          >
            ← Back to settings
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs text-mutedText hover:text-text"
          >
            <span className="text-base" aria-hidden="true">
              ⌂
            </span>
            Home
          </Link>
        </div>
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          {PLAN_COPY.headerLabel}
        </p>
        {weekRangeLabel ? (
          <p className="text-sm text-mutedText">{weekRangeLabel}</p>
        ) : null}
        <h1 className="text-3xl font-semibold text-text">
          {remark?.title ?? PLAN_COPY.fallbackTitle}
        </h1>
        <p className="text-sm text-mutedText">
          {remark?.body ?? PLAN_COPY.fallbackBody}
        </p>
        {status ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {status}
          </div>
        ) : null}
      </header>

      {!planningComplete ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-text">{PLAN_COPY.promptTitle}</h2>
            <p className="text-sm text-mutedText">{PLAN_COPY.promptNote}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_120px]">
            <label className="flex flex-col gap-2 text-sm text-mutedText">
              {PLAN_COPY.taskLabel}
              <input
                type="text"
                className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                placeholder={PLAN_COPY.taskPlaceholder}
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-mutedText">
              {PLAN_COPY.hoursLabel}
              <input
                type="text"
                inputMode="numeric"
                className="rounded-xl border border-slate-200 px-3 py-2 text-text"
                value={taskHours}
                onChange={(event) => setTaskHours(formatHoursInput(event.target.value))}
                onFocus={(event) => event.currentTarget.select()}
              />
              <span className="text-xs text-mutedText">{PLAN_COPY.hoursHelper}</span>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
                onClick={() => void handleAddTask()}
              >
                {PLAN_COPY.addTask}
              </button>
            </div>
          </div>

          {settings ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-text">{PLAN_COPY.quickTasksTitle}</p>
              <p className="text-xs text-mutedText">{PLAN_COPY.quickTasksNote}</p>
              <div className="flex flex-wrap gap-2">
                {maintenanceHours > 0 ? (
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs text-text"
                    onClick={() =>
                      void addTaskToPlan(
                        PLAN_COPY.quickTaskMaintenance,
                        maintenanceHours,
                        getDomainIdByName('Home & Life'),
                      )
                    }
                  >
                    {PLAN_COPY.quickTaskMaintenance} · {maintenanceHours}h
                  </button>
                ) : null}
                {commitmentsHours > 0 ? (
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs text-text"
                    onClick={() =>
                      void addTaskToPlan(
                        commitmentsLabel,
                        commitmentsHours,
                        getDomainIdByName('Work / Study'),
                      )
                    }
                  >
                    {commitmentsLabel} · {commitmentsHours}h
                  </button>
                ) : null}
                {sleepHours > 0 ? (
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs text-text"
                    onClick={() =>
                      void addTaskToPlan(
                        PLAN_COPY.quickTaskSleep,
                        sleepHours,
                        getDomainIdByName('Rest & Recharge'),
                      )
                    }
                  >
                    {PLAN_COPY.quickTaskSleep} · {sleepHours}h
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-text">{PLAN_COPY.taskListTitle}</p>
              <p className="text-xs text-mutedText">{PLAN_COPY.taskListNote}</p>
            </div>
            {planningHoursLeft !== null ? (
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-mutedText">
                  <span className="font-medium text-text">
                    {PLAN_COPY.planningLeftLabel}:
                  </span>
                  <span>{Math.round(planningHoursLeft)}h</span>
                  <span className="text-mutedText">
                    of {Math.round(planningCapacityHours ?? 0)}h
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.round(planningCapacityHours ?? 0))}
                  value={Math.min(
                    Math.round(plannedTaskHours),
                    Math.round(planningCapacityHours ?? 0),
                  )}
                  readOnly
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex items-center justify-between text-xs text-mutedText">
                  <span>0h</span>
                  <span>{Math.round(planningCapacityHours ?? 0)}h</span>
                </div>
              </div>
            ) : null}
            {taskList.length === 0 ? (
              <p className="text-sm text-mutedText">{PLAN_COPY.emptyTaskHint}</p>
            ) : (
              <div className="space-y-2">
                {taskList.map(({ task, domain }) => (
                  <div
                    key={task.id}
                    className="relative flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <input
                      type="text"
                      className="min-w-[180px] flex-1 text-sm text-text outline-none"
                      value={task.title}
                      onChange={(event) =>
                        handleTaskFieldChange(domain.id, task.id, {
                          title: event.target.value,
                        })
                      }
                      onBlur={(event) =>
                        handleTaskFieldChange(
                          domain.id,
                          task.id,
                          { title: event.target.value.trim() },
                          true,
                        )
                      }
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-text"
                      value={String(task.plannedHours)}
                      onChange={(event) =>
                        handleTaskFieldChange(domain.id, task.id, {
                          plannedHours: (() => {
                            const cleaned = formatHoursInput(event.target.value);
                            return cleaned === '' ? 0 : Number(cleaned);
                          })(),
                        })
                      }
                      onBlur={(event) =>
                        handleTaskFieldChange(
                          domain.id,
                          task.id,
                          {
                            plannedHours: (() => {
                              const cleaned = formatHoursInput(event.target.value);
                              return cleaned === '' ? 0 : Number(cleaned);
                            })(),
                          },
                          true,
                        )
                      }
                      onFocus={(event) => event.currentTarget.select()}
                      aria-label={PLAN_COPY.hoursAria}
                    />
                    <div className="relative">
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs text-mutedText"
                        onClick={() =>
                          setDomainPickerTaskId(
                            domainPickerTaskId === task.id ? null : task.id,
                          )
                        }
                      >
                        {domain.name} ▾
                      </button>
                      {domainPickerTaskId === task.id ? (
                        <div className="absolute right-0 top-9 z-10 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                          <p className="px-2 pb-1 text-xs uppercase tracking-[0.2em] text-mutedText">
                            {PLAN_COPY.domainPickerLabel}
                          </p>
                          <div className="max-h-40 space-y-1 overflow-auto">
                            {weekPlan?.domains.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs ${
                                  option.id === domain.id
                                    ? 'bg-slate-100 text-text'
                                    : 'text-mutedText hover:bg-slate-50'
                                }`}
                                onClick={() =>
                                  void handleAssignTaskDomain(task.id, domain.id, option.id)
                                }
                              >
                                {option.name}
                                {option.id === domain.id ? '•' : null}
                              </button>
                            ))}
                          </div>
                          <div className="mt-2 border-t border-slate-100 pt-2">
                            <p className="px-2 text-xs text-mutedText">{PLAN_COPY.createDomain}</p>
                            <input
                              type="text"
                              className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-text"
                              value={newDomainName}
                              placeholder={PLAN_COPY.domainOtherPlaceholder}
                              onChange={(event) => setNewDomainName(event.target.value)}
                            />
                            <button
                              type="button"
                              className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-text"
                              onClick={() =>
                                void handleCreateDomainForTask(task.id, domain.id)
                              }
                              disabled={!newDomainName.trim() || weekPlan?.domains.length === 7}
                            >
                              {PLAN_COPY.createDomain}
                            </button>
                            {weekPlan?.domains.length === 7 ? (
                              <p className="mt-2 text-[11px] text-mutedText">
                                {PLAN_COPY.domainLimitNote}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="ml-auto text-xs text-mutedText hover:text-text"
                      onClick={() => handleRemoveTask(domain.id, task.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-mutedText">{PLAN_COPY.domainAssignHelper}</p>
          </div>
        </div>
        {lastWeekPlan ? (
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-text">
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Last week
            </p>
            <p className="mt-2 text-sm font-medium text-text">
              Tasks & completion
            </p>
            <p className="mt-1 text-xs text-mutedText">
              A quick reference from the previous plan.
            </p>
            <div className="mt-4 space-y-3">
              {lastWeekTasks.length === 0 ? (
                <p className="text-xs text-mutedText">
                  No tasks logged last week.
                </p>
              ) : (
                lastWeekTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <div className="flex items-center justify-between text-xs text-mutedText">
                      <span className="font-medium text-text">{task.title}</span>
                      <span>{task.domainName}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-mutedText">
                      <span>{Math.round(task.plannedHours)}h planned</span>
                      <span>{Math.round(task.completedHours)}h completed</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        ) : null}
        </div>
      </section>
      ) : null}

      {planningComplete ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-text">
                  {PLAN_COPY.plotHeader}
                </h2>
                <p className="text-sm text-mutedText">{PLAN_COPY.plotSubtext}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {plotToggle}
                {plotMode === 'ikigai' ? (
                  <p className="text-xs text-mutedText">
                    Domains roll up into Energy, Growth, Contribution, Alignment.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-xs text-text"
                  onClick={handleReopenPlanning}
                >
                  ↺ Update plan
                </button>
              </div>
            </div>
            <div className="flex flex-col items-center gap-4">
              {weekPlan ? (
                plotMode === 'domains' ? (
                  <IkigaiWheelPlot
                    domains={weekPlan.domains}
                    activeDomainId={selectedDomainId}
                    showSkeleton={!hasTasks}
                    onSelectDomain={(domainId) => {
                      setSelectedPrincipleId(null);
                      setSelectedDomainId(domainId);
                      setSidebarOpen(true);
                    }}
                  />
                ) : (
                  <IkigaiPrinciplesPlot
                    domains={weekPlan.domains}
                    activePrincipleId={selectedPrincipleId}
                    onSelectPrinciple={(principleId) => {
                      setSelectedDomainId(null);
                      setSelectedPrincipleId(principleId);
                      setSidebarOpen(true);
                    }}
                  />
                )
              ) : (
                <div className="h-[320px] w-[320px]" />
              )}
              <div className="text-center">
                <p className="text-sm font-medium text-text">
                  {hasTasks && largestDomain
                    ? PLAN_COPY.largestDomainLabel
                    : PLAN_COPY.pickDomain}
                </p>
                <p className="text-xs text-mutedText">
                  {hasTasks && largestDomain
                    ? PLAN_COPY.largestDomainNote
                    : PLAN_COPY.renameHint}
                </p>
              </div>
              <p className="text-xs text-mutedText">{PLAN_COPY.plotHint}</p>
              <p className="text-xs text-mutedText">{PLAN_COPY.plotNote}</p>
              {weekPlan && weekPlan.domains.length >= 7 ? (
                <span className="text-xs text-mutedText">{PLAN_COPY.maxDomains}</span>
              ) : null}
              {sidebarOpen ? (
                <div className="w-full rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text">
                      {PLAN_COPY.taskPanelTitle}
                    </h3>
                    <button
                      type="button"
                      className="text-xs text-mutedText hover:text-text"
                      onClick={() => {
                        setSelectedDomainId(null);
                        setSelectedPrincipleId(null);
                        setSidebarOpen(false);
                      }}
                    >
                      ✕ Close
                    </button>
                  </div>
                  {plotMode === 'ikigai' ? (
                    <>
                      {selectedPrincipleId ? (
                        <button
                          type="button"
                          className="mt-2 text-xs text-mutedText hover:text-text"
                          onClick={() => setSelectedPrincipleId(null)}
                        >
                          ← Back to principles
                        </button>
                      ) : null}
                      {!selectedPrincipleId ? (
                        <div className="mt-3 space-y-2">
                          {principleTotals.map((principle) => (
                            <button
                              key={principle.id}
                              type="button"
                              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-text"
                              onClick={() => setSelectedPrincipleId(principle.id)}
                            >
                              <span className="font-medium">{principle.label}</span>
                              <span className="text-xs text-mutedText">
                                {Math.round(principle.hours)}h
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : principleTasks.length === 0 ? (
                        <p className="mt-3 text-sm text-mutedText">
                          No tasks under this principle yet.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {principleTasks.map((task) => (
                            <div
                              key={task.id}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                            >
                              <div className="text-sm font-medium text-text">
                                {task.title}
                              </div>
                              <div className="mt-2 flex items-center justify-between text-xs text-mutedText">
                                <span>{task.domainName}</span>
                                <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-text">
                                  {task.hours}h
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {selectedDomain ? (
                        <button
                          type="button"
                          className="mt-2 text-xs text-mutedText hover:text-text"
                          onClick={() => setSelectedDomainId(null)}
                        >
                          ← Back to domains
                        </button>
                      ) : null}
                      {!selectedDomain ? (
                        <div className="mt-3 space-y-2">
                          {weekPlan?.domains.map((domain) => (
                            <button
                              key={domain.id}
                              type="button"
                              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-text"
                              onClick={() => setSelectedDomainId(domain.id)}
                            >
                              <span className="font-medium">{domain.name}</span>
                              <span className="text-xs text-mutedText">
                                {Math.round(domain.plannedHours)}h
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : selectedDomain.tasks.length === 0 ? (
                        <p className="mt-3 text-sm text-mutedText">
                          {PLAN_COPY.taskPanelEmpty}
                        </p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {selectedDomain.tasks.map((task) => (
                            <div
                              key={task.id}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                            >
                              <div className="text-sm font-medium text-text">
                                {task.title}
                              </div>
                              <div className="mt-2 text-xs text-mutedText">
                                <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-text">
                                  {task.plannedHours}h
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section className="grid gap-6">
          <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-text">{PLAN_COPY.plotHeader}</h2>
                <p className="text-sm text-mutedText">{PLAN_COPY.plotSubtext}</p>
              </div>
              {plotToggle}
              {plotMode === 'ikigai' ? (
                <p className="text-xs text-mutedText">
                  Domains roll up into Energy, Growth, Contribution, Alignment.
                </p>
              ) : null}
              <div className="flex flex-col items-center gap-4">
                {weekPlan ? (
                plotMode === 'domains' ? (
                  <IkigaiWheelPlot
                    domains={weekPlan.domains}
                    activeDomainId={selectedDomainId}
                    showSkeleton={!hasTasks}
                    onSelectDomain={(domainId) => {
                      setSelectedPrincipleId(null);
                      setSelectedDomainId(domainId);
                      setSidebarOpen(true);
                    }}
                  />
                ) : (
                  <IkigaiPrinciplesPlot
                    domains={weekPlan.domains}
                    activePrincipleId={selectedPrincipleId}
                    onSelectPrinciple={(principleId) => {
                      setSelectedDomainId(null);
                      setSelectedPrincipleId(principleId);
                      setSidebarOpen(true);
                    }}
                  />
                )
              ) : (
                <div className="h-[320px] w-[320px]" />
              )}
                <div className="text-center">
                  <p className="text-sm font-medium text-text">
                    {hasTasks && largestDomain
                      ? PLAN_COPY.largestDomainLabel
                      : PLAN_COPY.pickDomain}
                  </p>
                  <p className="text-xs text-mutedText">
                    {hasTasks && largestDomain
                      ? PLAN_COPY.largestDomainNote
                      : PLAN_COPY.renameHint}
                  </p>
                </div>
                <p className="text-xs text-mutedText">{PLAN_COPY.plotHint}</p>
                <p className="text-xs text-mutedText">{PLAN_COPY.plotNote}</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 px-3 py-1 text-xs text-text"
                    onClick={() => setSidebarOpen(true)}
                  >
                    View domains
                  </button>
                  {weekPlan && weekPlan.domains.length >= 7 ? (
                    <span className="text-xs text-mutedText">
                      {PLAN_COPY.maxDomains}
                    </span>
                  ) : null}
                </div>
                {sidebarOpen ? (
                  <div className="w-full rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-text">
                        {PLAN_COPY.taskPanelTitle}
                      </h3>
                      <button
                        type="button"
                        className="text-xs text-mutedText hover:text-text"
                        onClick={() => {
                          setSelectedDomainId(null);
                          setSelectedPrincipleId(null);
                          setSidebarOpen(false);
                        }}
                      >
                        ✕ Close
                      </button>
                    </div>
                    {plotMode === 'ikigai' ? (
                      <>
                        {selectedPrincipleId ? (
                          <button
                            type="button"
                            className="mt-2 text-xs text-mutedText hover:text-text"
                            onClick={() => setSelectedPrincipleId(null)}
                          >
                            ← Back to principles
                          </button>
                        ) : null}
                        {!selectedPrincipleId ? (
                          <div className="mt-3 space-y-2">
                            {principleTotals.map((principle) => (
                              <button
                                key={principle.id}
                                type="button"
                                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-text"
                                onClick={() => setSelectedPrincipleId(principle.id)}
                              >
                                <span className="font-medium">
                                  {principle.label}
                                </span>
                                <span className="text-xs text-mutedText">
                                  {Math.round(principle.hours)}h
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : principleTasks.length === 0 ? (
                          <p className="mt-3 text-sm text-mutedText">
                            No tasks under this principle yet.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {principleTasks.map((task) => (
                              <div
                                key={task.id}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                              >
                                <div className="text-sm font-medium text-text">
                                  {task.title}
                                </div>
                                <div className="mt-2 flex items-center justify-between text-xs text-mutedText">
                                  <span>{task.domainName}</span>
                                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-text">
                                    {task.hours}h
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {selectedDomain ? (
                          <button
                            type="button"
                            className="mt-2 text-xs text-mutedText hover:text-text"
                            onClick={() => setSelectedDomainId(null)}
                          >
                            ← Back to domains
                          </button>
                        ) : null}
                        {!selectedDomain ? (
                          <div className="mt-3 space-y-2">
                            {weekPlan?.domains.map((domain) => (
                              <button
                                key={domain.id}
                                type="button"
                                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-text"
                                onClick={() => setSelectedDomainId(domain.id)}
                              >
                                <span className="font-medium">{domain.name}</span>
                                <span className="text-xs text-mutedText">
                                  {Math.round(domain.plannedHours)}h
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : selectedDomain.tasks.length === 0 ? (
                          <p className="mt-3 text-sm text-mutedText">
                            {PLAN_COPY.taskPanelEmpty}
                          </p>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {selectedDomain.tasks.map((task) => (
                              <div
                                key={task.id}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                              >
                                <div className="text-sm font-medium text-text">
                                  {task.title}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-mutedText">
                                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-text">
                                    {task.plannedHours}h
                                  </span>
                                  <div className="relative">
                                    <button
                                      type="button"
                                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-mutedText"
                                      onClick={() =>
                                        setDomainPickerTaskId(
                                          domainPickerTaskId === task.id ? null : task.id,
                                        )
                                      }
                                    >
                                      {selectedDomain.name} ▾
                                    </button>
                                    {domainPickerTaskId === task.id ? (
                                      <div className="absolute left-0 top-9 z-10 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                                        <p className="px-2 pb-1 text-xs uppercase tracking-[0.2em] text-mutedText">
                                          {PLAN_COPY.domainPickerLabel}
                                        </p>
                                        <div className="max-h-40 space-y-1 overflow-auto">
                                          {weekPlan?.domains.map((option) => (
                                            <button
                                              key={option.id}
                                              type="button"
                                              className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs ${
                                                option.id === selectedDomain.id
                                                  ? 'bg-slate-100 text-text'
                                                  : 'text-mutedText hover:bg-slate-50'
                                              }`}
                                              onClick={() =>
                                                void handleAssignTaskDomain(
                                                  task.id,
                                                  selectedDomain.id,
                                                  option.id,
                                                )
                                              }
                                            >
                                              {option.name}
                                              {option.id === selectedDomain.id
                                                ? '•'
                                                : null}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      )}

      {!planningComplete ? (
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
              onClick={() =>
                weekPlan && void persistPlan(weekPlan, PLAN_COPY.saveStatus)
              }
              disabled={!weekPlan}
            >
              {PLAN_COPY.saveDraft}
            </button>
            {status === PLAN_COPY.saveStatus ? (
              <p className="text-xs text-mutedText">{PLAN_COPY.saveStatus}</p>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-text"
              onClick={handleCompletePlanning}
              disabled={!weekPlan}
            >
              {PLAN_COPY.completePlanning}
            </button>
            <p className="text-xs text-mutedText">{PLAN_COPY.saveDraftNote}</p>
          </div>
        </section>
      ) : null}

    </main>
  );
}
