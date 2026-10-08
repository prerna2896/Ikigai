import type { Settings, WeekPlan } from '@ikigai/core';

const WEEK_DAY_INDEX: Record<Settings['weekStartDay'], number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export const formatLocalISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getCurrentWeekStartISO = (
  weekStartDay: Settings['weekStartDay'],
  today: Date = new Date(),
): string => {
  const target = WEEK_DAY_INDEX[weekStartDay];
  const todayIndex = today.getDay();
  const diff = (todayIndex - target + 7) % 7;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - diff);
  return formatLocalISODate(start);
};

export const findPlanForWeekStart = (
  plans: WeekPlan[],
  weekStartISO: string,
): WeekPlan | null =>
  plans.find((p) => p.weekStartISO === weekStartISO) ?? null;

export const priorWeekStartISO = (weekStartISO: string): string => {
  const start = new Date(`${weekStartISO}T00:00:00`);
  start.setDate(start.getDate() - 7);
  return formatLocalISODate(start);
};

// Walks backward one week at a time from (but not including) fromWeekStartISO,
// returning up to `count` plans, most-recent-first. Stops early (returns
// fewer than `count`) if a week has no plan — a gap means there's no
// continuous history to look at past that point, not a week to skip
// over. Used for multi-week pattern checks (see
// computeWeeklySignals' sustained_underdelivery) that need more than
// just the single immediately-prior week.
export const findPriorPlans = (
  sortedPlans: WeekPlan[],
  fromWeekStartISO: string,
  count: number,
): WeekPlan[] => {
  const result: WeekPlan[] = [];
  let cursor = fromWeekStartISO;
  for (let i = 0; i < count; i += 1) {
    cursor = priorWeekStartISO(cursor);
    const plan = findPlanForWeekStart(sortedPlans, cursor);
    if (!plan) break;
    result.push(plan);
  }
  return result;
};

export type CurrentWeekStatus =
  | { kind: 'unplanned'; currentWeekStartISO: string }
  | { kind: 'planned'; currentWeekStartISO: string; plan: WeekPlan };

export const resolveCurrentWeek = (
  plans: WeekPlan[],
  settings: Settings | null,
  today: Date = new Date(),
): CurrentWeekStatus => {
  const weekStartDay = settings?.weekStartDay ?? 'monday';
  const currentWeekStartISO = getCurrentWeekStartISO(weekStartDay, today);
  const plan = findPlanForWeekStart(plans, currentWeekStartISO);
  if (plan) {
    return { kind: 'planned', currentWeekStartISO, plan };
  }
  return { kind: 'unplanned', currentWeekStartISO };
};

export const daysSinceISO = (
  iso: string | null | undefined,
  today: Date = new Date(),
): number | null => {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const thenMidnight = new Date(
    then.getFullYear(),
    then.getMonth(),
    then.getDate(),
  );
  const diffMs = todayMidnight.getTime() - thenMidnight.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};
