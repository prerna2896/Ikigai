'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { DomainTask, WeekDomain, WeekPlan } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import {
  derivePlannedHours,
  getWeekStartISO,
  applyDefaultDomainNames,
  withDerivedPlannedHours,
} from '../../planUtils';

export default function WeekDomainPage() {
  const router = useRouter();
  const params = useParams();
  const domainId = params?.domainId as string;
  const [repository, setRepository] = useState<ReturnType<
    typeof getLocalRepository
  > | null>(null);
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [domain, setDomain] = useState<WeekDomain | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskHours, setNewTaskHours] = useState('1');
  const [status, setStatus] = useState<string | null>(null);

  const formatHoursInput = (value: string) =>
    value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');

  const parseHours = (value: string, fallback: number) => {
    const cleaned = formatHoursInput(value);
    if (!cleaned) {
      return fallback;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  useEffect(() => {
    try {
      const repo = getLocalRepository();
      setRepository(repo);
      Promise.all([repo.getSettings(), repo.listWeekPlans()])
        .then(async ([settings, plans]) => {
          const timeZone =
            settings.weekTimeZone ||
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            'UTC';
          const weekStartDay = settings.weekStartDay || 'sunday';
          const preferNextWeek = plans.length === 0;
          const weekStartISO = getWeekStartISO(
            new Date(),
            weekStartDay,
            preferNextWeek,
          );
          const record = await repo.getWeekPlan(weekStartISO);
          if (!record) {
            router.replace('/week/plan');
            return;
          }
          const normalized = applyDefaultDomainNames(record);
          if (
            normalized !== record ||
            !normalized.weekTimeZone ||
            !normalized.weekStartDay
          ) {
            await repo.saveWeekPlan({
              ...normalized,
              weekTimeZone: normalized.weekTimeZone || timeZone,
              weekStartDay: normalized.weekStartDay || weekStartDay,
            });
          }
          const withDerived = withDerivedPlannedHours(normalized);
          setPlan(withDerived);
          const found = withDerived.domains.find((item) => item.id === domainId);
          if (!found) {
            router.replace('/week/plan');
            return;
          }
          setDomain(found);
          setNameInput(found.name);
        })
        .catch((error) => setStatus(String(error)));
    } catch (error) {
      setStatus(String(error));
    }
  }, [domainId, router]);

  const handleSave = async (updatedDomain: WeekDomain) => {
    if (!repository || !plan) {
      return;
    }
    const updatedPlan: WeekPlan = {
      ...plan,
      domains: plan.domains.map((item) =>
        item.id === updatedDomain.id ? updatedDomain : item,
      ),
    };
    await repository.saveWeekPlan(updatedPlan);
    setPlan(withDerivedPlannedHours(updatedPlan));
    setDomain(updatedDomain);
    setStatus('Saved.');
  };

  const handleAddTask = async () => {
    if (!domain) {
      return;
    }
    const trimmed = newTaskTitle.trim();
    if (!trimmed) {
      return;
    }
    const task: DomainTask = {
      id: crypto.randomUUID(),
      title: trimmed,
      plannedHours: parseHours(newTaskHours, 1),
    };
    const updated: WeekDomain = {
      ...domain,
      tasks: [...domain.tasks, task],
      plannedHours: derivePlannedHours({ ...domain, tasks: [...domain.tasks, task] }),
    };
    setNewTaskTitle('');
    setNewTaskHours('1');
    await handleSave(updated);
  };

  const handleRemoveTask = async (taskId: string) => {
    if (!domain) {
      return;
    }
    const updated: WeekDomain = {
      ...domain,
      tasks: domain.tasks.filter((task) => task.id !== taskId),
      plannedHours: derivePlannedHours({
        ...domain,
        tasks: domain.tasks.filter((task) => task.id !== taskId),
      }),
    };
    await handleSave(updated);
  };

  const handleRename = async () => {
    if (!domain) {
      return;
    }
    const trimmed = nameInput.trim();
    const updated: WeekDomain = {
      ...domain,
      name: trimmed || domain.name,
    };
    await handleSave(updated);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          Domain
        </p>
        <h1 className="text-3xl font-semibold text-text">
          {domain?.name ?? 'Domain'}
        </h1>
        <p className="text-sm text-mutedText">
          Rename the domain and adjust tasks for this week.
        </p>
        {status ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {status}
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <label className="flex flex-col gap-2 text-sm text-mutedText">
          Domain name
          <input
            type="text"
            className="rounded-xl border border-slate-200 px-3 py-2 text-text"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            onBlur={() => void handleRename()}
            placeholder="Domain name"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 text-sm text-mutedText">
            New task
            <input
              type="text"
              className="rounded-xl border border-slate-200 px-3 py-2 text-text"
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              placeholder="Task title"
            />
          </div>
          <label className="flex flex-col gap-2 text-sm text-mutedText">
            Planned hours
            <input
              type="text"
              inputMode="numeric"
              className="rounded-xl border border-slate-200 px-3 py-2 text-text"
              value={newTaskHours}
              onChange={(event) => setNewTaskHours(formatHoursInput(event.target.value))}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
            onClick={() => void handleAddTask()}
          >
            Add task
          </button>
          {domain?.tasks.length ? (
            <div className="space-y-2 text-sm text-mutedText">
              {domain.tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-text">{task.title}</div>
                      <div>{task.plannedHours}h planned</div>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-mutedText hover:text-text"
                      onClick={() => void handleRemoveTask(task.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-mutedText">No tasks yet.</p>
          )}
        </div>
      </section>

      <footer className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-full border border-slate-300 px-4 py-2 text-text"
          onClick={() => router.push('/week/plan')}
        >
          Back to plan
        </button>
      </footer>
    </main>
  );
}
