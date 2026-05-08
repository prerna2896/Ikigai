'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  Settings,
  WeekLogEntry,
  WeekNote,
  WeekPlan,
} from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';
import { withDerivedPlannedHours } from '../../week/plan/planUtils';
import {
  decodeReflectionNote,
  reflectionCategoryLabel,
  type ParsedReflectionNote,
  type ReflectionCategoryId,
} from '../../../lib/reflectionNotes';

// ----- Geometry / palette ---------------------------------------------------

const RHYTHM_WEEKS = 12;
const SPARK_WEEKS = 12;

const DOMAIN_PALETTE = [
  '#7fb6a1',
  '#9ec48a',
  '#8aa8d6',
  '#d69b8a',
  '#e0c068',
  '#b89ad6',
  '#9ab8c6',
];

const colorForDomainIndex = (i: number) =>
  DOMAIN_PALETTE[i % DOMAIN_PALETTE.length];

// ----- Helpers --------------------------------------------------------------

const toLocalDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
};

const formatWeekRange = (plan: WeekPlan, timeZone: string) => {
  const start = new Date(`${plan.weekStartISO}T00:00:00`);
  const end = new Date(`${plan.weekEndISO}T00:00:00`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone,
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

const formatNoteDate = (iso: string, timeZone: string) => {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(date);
};

const sumLogHours = (logs: WeekLogEntry[]) =>
  logs.reduce(
    (total, log) =>
      total +
      Object.values(log.taskHours).reduce((a, b) => a + (b || 0), 0),
    0,
  );

// Map a number to opacity in [min, max] based on its share of `peak`.
const intensityOpacity = (value: number, peak: number, min = 0.08, max = 0.85) => {
  if (peak <= 0 || value <= 0) return 0;
  const share = Math.min(1, value / peak);
  return min + (max - min) * share;
};

// ----- Page -----------------------------------------------------------------

export default function HistoryPreviewPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weekPlans, setWeekPlans] = useState<WeekPlan[]>([]);
  const [logsByWeek, setLogsByWeek] = useState<Record<string, WeekLogEntry[]>>(
    {},
  );
  const [notesByWeek, setNotesByWeek] = useState<Record<string, WeekNote[]>>(
    {},
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const repo = getLocalRepository();
    Promise.all([repo.getSettings(), repo.listWeekPlans()])
      .then(async ([settingsRecord, plans]) => {
        if (cancelled) return;
        setSettings(settingsRecord);
        const sorted = [...plans].sort((a, b) =>
          a.weekStartISO < b.weekStartISO ? 1 : -1,
        );
        setWeekPlans(sorted);
        const logsAcc: Record<string, WeekLogEntry[]> = {};
        const notesAcc: Record<string, WeekNote[]> = {};
        await Promise.all(
          sorted.map(async (plan) => {
            const [logs, notes] = await Promise.all([
              repo.getWeekLogs(plan.id),
              repo.listWeekNotes(plan.id),
            ]);
            logsAcc[plan.id] = logs;
            notesAcc[plan.id] = notes;
          }),
        );
        if (cancelled) return;
        setLogsByWeek(logsAcc);
        setNotesByWeek(notesAcc);
      })
      .catch((error) => setStatus(String(error)));
    return () => {
      cancelled = true;
    };
  }, []);

  const timeZone =
    settings?.weekTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  // Sorted oldest → newest, for time-series renderers that expect left-to-right
  // chronological order.
  const chronological = useMemo(() => {
    return [...weekPlans]
      .sort((a, b) => (a.weekStartISO < b.weekStartISO ? -1 : 1))
      .map((plan) => {
        const derived = withDerivedPlannedHours(plan);
        const logs = logsByWeek[plan.id] ?? [];
        const planned = derived.domains.reduce(
          (sum, d) => sum + (d.plannedHours || 0),
          0,
        );
        const completed = sumLogHours(logs);
        return { plan: derived, planned, completed };
      });
  }, [weekPlans, logsByWeek]);

  const recent = useMemo(
    () => chronological.slice(-RHYTHM_WEEKS),
    [chronological],
  );

  // Build the union of domain names across the recent window. Each domain
  // gets a stable colour by its index in this sorted list.
  const domainSeries = useMemo(() => {
    const order: string[] = [];
    const planSeries: Record<string, number[]> = {};
    const completedSeries: Record<string, number[]> = {};
    recent.forEach((row, weekIndex) => {
      row.plan.domains.forEach((domain) => {
        if (!order.includes(domain.name)) {
          order.push(domain.name);
          planSeries[domain.name] = Array(recent.length).fill(0);
          completedSeries[domain.name] = Array(recent.length).fill(0);
        }
        planSeries[domain.name][weekIndex] += domain.plannedHours || 0;
      });
      // Completed per domain — sum any logged taskHours whose taskId
      // belongs to a task in that domain.
      const taskToDomain: Record<string, string> = {};
      row.plan.domains.forEach((domain) => {
        domain.tasks.forEach((task) => {
          taskToDomain[task.id] = domain.name;
        });
      });
      const logs = logsByWeek[row.plan.id] ?? [];
      logs.forEach((log) => {
        Object.entries(log.taskHours).forEach(([taskId, hours]) => {
          const domainName = taskToDomain[taskId];
          if (!domainName) return;
          if (!order.includes(domainName)) {
            order.push(domainName);
            planSeries[domainName] = Array(recent.length).fill(0);
            completedSeries[domainName] = Array(recent.length).fill(0);
          }
          completedSeries[domainName][weekIndex] += hours || 0;
        });
      });
    });
    // Drop domains that never had any planned or completed hours in window.
    const active = order.filter((name) => {
      const planned = planSeries[name].some((v) => v > 0);
      const completed = completedSeries[name].some((v) => v > 0);
      return planned || completed;
    });
    // Sort by total planned hours desc — most-allocated first.
    active.sort((a, b) => {
      const sumA = planSeries[a].reduce((s, v) => s + v, 0);
      const sumB = planSeries[b].reduce((s, v) => s + v, 0);
      return sumB - sumA;
    });
    return active.map((name, index) => ({
      name,
      color: colorForDomainIndex(index),
      planned: planSeries[name].slice(-SPARK_WEEKS),
      completed: completedSeries[name].slice(-SPARK_WEEKS),
    }));
  }, [recent, logsByWeek]);

  const reflectionItems = useMemo(() => {
    const items: Array<
      ParsedReflectionNote & {
        weekStartISO: string;
        weekRange: string;
      }
    > = [];
    weekPlans.forEach((plan) => {
      const notes = notesByWeek[plan.id] ?? [];
      notes.forEach((note) => {
        const parsed = decodeReflectionNote(note);
        if (!parsed.text.trim()) return;
        items.push({
          ...parsed,
          weekStartISO: plan.weekStartISO,
          weekRange: formatWeekRange(plan, timeZone),
        });
      });
    });
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return items;
  }, [weekPlans, notesByWeek, timeZone]);

  const peakPlanned = useMemo(
    () => Math.max(0, ...recent.map((r) => r.planned)),
    [recent],
  );

  const narrative = useMemo(() => {
    if (recent.length === 0) {
      return 'No weeks yet. Plan one and the history will start to take shape.';
    }
    const totalPlanned = recent.reduce((sum, r) => sum + r.planned, 0);
    const totalCompleted = recent.reduce((sum, r) => sum + r.completed, 0);
    const avgPlanned = totalPlanned / recent.length;
    const heaviest = [...domainSeries]
      .sort(
        (a, b) =>
          b.planned.reduce((s, v) => s + v, 0) -
          a.planned.reduce((s, v) => s + v, 0),
      )[0];
    const lightest = [...domainSeries]
      .filter(
        (d) => d.planned.reduce((s, v) => s + v, 0) > 0,
      )
      .sort(
        (a, b) =>
          a.planned.reduce((s, v) => s + v, 0) -
          b.planned.reduce((s, v) => s + v, 0),
      )[0];
    const fragments: string[] = [];
    fragments.push(
      `The last ${recent.length} ${recent.length === 1 ? 'week' : 'weeks'} averaged ${Math.round(avgPlanned)}h planned`,
    );
    if (totalCompleted > 0) {
      const ratio = totalPlanned > 0 ? totalCompleted / totalPlanned : 0;
      fragments.push(`with about ${Math.round(ratio * 100)}% logged`);
    }
    let line = `${fragments.join(' ')}.`;
    if (heaviest) {
      line += ` ${heaviest.name} took the most space`;
      if (lightest && lightest.name !== heaviest.name) {
        line += `; ${lightest.name} the least.`;
      } else {
        line += '.';
      }
    }
    return line;
  }, [recent, domainSeries]);

  return (
    <main
      className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12"
      data-testid="history-preview-page"
    >
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          History · Preview
        </p>
        <h1 className="text-3xl font-semibold text-text">
          A softer look back
        </h1>
        <p className="max-w-xl text-sm text-mutedText">
          Patterns and reflections from your recent weeks. Sketch, not
          scoreboard.{' '}
          <Link
            href="/history"
            className="underline-offset-2 hover:underline"
          >
            Back to the existing history view
          </Link>
          .
        </p>
        {status ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {status}
          </p>
        ) : null}
      </header>

      <RhythmSection
        recent={recent}
        peakPlanned={peakPlanned}
        narrative={narrative}
        timeZone={timeZone}
      />

      <DomainSparklinesSection domains={domainSeries} />

      <ReflectionThreadSection items={reflectionItems} timeZone={timeZone} />
    </main>
  );
}

// ----- 1. Narrative + rhythm strip ------------------------------------------

function RhythmSection({
  recent,
  peakPlanned,
  narrative,
  timeZone,
}: {
  recent: Array<{ plan: WeekPlan; planned: number; completed: number }>;
  peakPlanned: number;
  narrative: string;
  timeZone: string;
}) {
  const cellWidth = 32;
  const cellGap = 6;
  const cellHeight = 56;
  const totalWidth = recent.length * (cellWidth + cellGap) - cellGap;
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
      data-testid="history-preview-rhythm"
    >
      <div className="space-y-2">
        <h2 className="text-sm uppercase tracking-[0.18em] text-mutedText">
          The shape of your weeks
        </h2>
        <p className="max-w-2xl text-base text-text" data-testid="history-preview-narrative">
          {narrative}
        </p>
      </div>
      <div className="mt-6 overflow-x-auto">
        {recent.length === 0 ? (
          <p className="text-sm text-mutedText">
            No weeks yet — once you plan a week, its rhythm shows up here.
          </p>
        ) : (
          <svg
            width={totalWidth}
            height={cellHeight + 22}
            viewBox={`0 0 ${totalWidth} ${cellHeight + 22}`}
            className="overflow-visible"
            role="img"
            aria-label="Rhythm of recent weeks"
          >
            {recent.map((row, i) => {
              const x = i * (cellWidth + cellGap);
              const fill = `rgba(127, 182, 161, ${intensityOpacity(
                row.planned,
                peakPlanned,
                0.08,
                0.78,
              )})`;
              const completedRatio =
                row.planned > 0
                  ? Math.min(1, row.completed / row.planned)
                  : 0;
              const innerHeight = cellHeight * completedRatio;
              return (
                <g key={row.plan.id} data-testid="rhythm-cell">
                  <rect
                    x={x}
                    y={0}
                    width={cellWidth}
                    height={cellHeight}
                    rx={4}
                    fill={fill}
                    stroke="rgba(15,23,42,0.08)"
                    strokeWidth={1}
                  />
                  {/* Completed overlay — saturated bar growing from bottom up */}
                  {innerHeight > 0 ? (
                    <rect
                      x={x + 4}
                      y={cellHeight - innerHeight}
                      width={cellWidth - 8}
                      height={innerHeight}
                      rx={2}
                      fill="rgba(95, 127, 123, 0.55)"
                    />
                  ) : null}
                  <text
                    x={x + cellWidth / 2}
                    y={cellHeight + 14}
                    textAnchor="middle"
                    fontSize={10}
                    fill="currentColor"
                    className="text-mutedText"
                  >
                    {new Intl.DateTimeFormat('en-US', {
                      month: 'short',
                      day: 'numeric',
                      timeZone,
                    }).format(new Date(`${row.plan.weekStartISO}T00:00:00`))}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="mt-4 text-xs text-mutedText">
        Cell density = total planned hours that week. The darker bar inside
        is the share that was logged.
      </p>
    </section>
  );
}

// ----- 2. Per-domain sparklines ---------------------------------------------

function DomainSparklinesSection({
  domains,
}: {
  domains: Array<{
    name: string;
    color: string;
    planned: number[];
    completed: number[];
  }>;
}) {
  if (domains.length === 0) {
    return (
      <section
        className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
        data-testid="history-preview-sparklines"
      >
        <h2 className="text-sm uppercase tracking-[0.18em] text-mutedText">
          Domain drift
        </h2>
        <p className="mt-3 text-sm text-mutedText">
          Add a few tasks across domains and the sparklines will show how
          each one trends.
        </p>
      </section>
    );
  }
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
      data-testid="history-preview-sparklines"
    >
      <div className="space-y-2">
        <h2 className="text-sm uppercase tracking-[0.18em] text-mutedText">
          Domain drift
        </h2>
        <p className="max-w-2xl text-sm text-mutedText">
          One line per domain across the last {SPARK_WEEKS} weeks. Solid =
          planned, dotted = logged.
        </p>
      </div>
      <ul className="mt-6 divide-y divide-slate-200">
        {domains.map((domain) => (
          <DomainSparklineRow key={domain.name} domain={domain} />
        ))}
      </ul>
    </section>
  );
}

function DomainSparklineRow({
  domain,
}: {
  domain: {
    name: string;
    color: string;
    planned: number[];
    completed: number[];
  };
}) {
  const width = 220;
  const height = 36;
  const padding = 4;
  const peak = Math.max(
    1,
    ...domain.planned,
    ...domain.completed,
  );
  const stepX =
    domain.planned.length > 1
      ? (width - padding * 2) / (domain.planned.length - 1)
      : 0;
  const yFor = (value: number) =>
    height - padding - (value / peak) * (height - padding * 2);
  const buildPath = (values: number[]) =>
    values
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${padding + i * stepX} ${yFor(v)}`)
      .join(' ');
  const totalPlanned = domain.planned.reduce((s, v) => s + v, 0);
  const totalCompleted = domain.completed.reduce((s, v) => s + v, 0);
  const lastPlanned = domain.planned[domain.planned.length - 1] ?? 0;
  return (
    <li
      className="flex items-center gap-4 py-3"
      data-testid="domain-sparkline-row"
      data-domain-name={domain.name}
    >
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: domain.color }}
      />
      <span className="w-36 shrink-0 truncate text-sm font-medium text-text">
        {domain.name}
      </span>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0"
        role="img"
        aria-label={`${domain.name} planned and logged hours`}
      >
        {/* Faint baseline */}
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="rgba(15,23,42,0.08)"
          strokeWidth={1}
        />
        {/* Planned (solid) */}
        <path
          d={buildPath(domain.planned)}
          fill="none"
          stroke={domain.color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Completed (dotted overlay) */}
        <path
          d={buildPath(domain.completed)}
          fill="none"
          stroke={domain.color}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="2 3"
          opacity={0.85}
        />
      </svg>
      <span className="ml-auto whitespace-nowrap text-xs text-mutedText">
        {Math.round(lastPlanned)}h this week
        {totalCompleted > 0 ? ` · ${Math.round(totalCompleted)}h logged` : ''}
        {totalPlanned > 0 ? '' : ' (no plan yet)'}
      </span>
    </li>
  );
}

// ----- 3. Reflection thread -------------------------------------------------

const CATEGORY_EMOJI: Record<ReflectionCategoryId, string> = {
  on_mind: '💭',
  helped: '🌿',
  hindered: '🌧️',
  lessons: '✨',
  check_in: '📍',
};

function ReflectionThreadSection({
  items,
  timeZone,
}: {
  items: Array<
    ParsedReflectionNote & { weekStartISO: string; weekRange: string }
  >;
  timeZone: string;
}) {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm"
      data-testid="history-preview-reflections"
    >
      <div className="space-y-2">
        <h2 className="text-sm uppercase tracking-[0.18em] text-mutedText">
          Your own words
        </h2>
        <p className="max-w-2xl text-sm text-mutedText">
          Reflections from across all your weeks, newest first.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-mutedText">
          No reflections yet. Anything written on the Reflect page will land
          here as a thread.
        </p>
      ) : (
        <ol className="mt-6 space-y-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4"
              data-testid="reflection-thread-item"
            >
              <span
                aria-hidden
                className="mt-0.5 text-lg leading-none"
                title={
                  item.categoryId
                    ? reflectionCategoryLabel(item.categoryId)
                    : 'Note'
                }
              >
                {item.emoji ??
                  (item.categoryId ? CATEGORY_EMOJI[item.categoryId] : '📝')}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-mutedText">
                  <span className="font-medium text-text">
                    {reflectionCategoryLabel(item.categoryId)}
                  </span>
                  <span>·</span>
                  <span>{formatNoteDate(item.createdAt, timeZone)}</span>
                  <span>·</span>
                  <Link
                    href={`/week/${item.weekStartISO}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {item.weekRange}
                  </Link>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">
                  {item.text}
                </p>
                {item.tags.length > 0 ? (
                  <p className="text-xs text-mutedText">
                    {item.tags.map((tag) => `#${tag}`).join('  ')}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
