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
