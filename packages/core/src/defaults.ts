import type { Settings } from './types';
import { computeWeeklyCapacity, getBufferPercentForStrictness } from './derived';

export const DEFAULT_SETTINGS_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export const createDefaultSettings = (
  nowIso: string = DEFAULT_SETTINGS_TIMESTAMP,
  weekTimeZone: string = 'UTC',
  weekStartDay: Settings['weekStartDay'] = 'sunday',
): Settings => {
  const bufferPercent = getBufferPercentForStrictness('somewhat_flexible');
  const derived = computeWeeklyCapacity({
    sleepHoursPerDay: 8,
    maintenanceHoursPerDay: 1,
    jobHoursPerWeek: 0,
    classHoursPerWeek: 0,
    bufferPercent,
  });
  return {
    id: 'singleton',
    sleepHoursPerDay: 8,
    maintenanceHoursPerDay: 1,
    weeklyCapacityHours: 40,
    weeklyCapacityHoursDerived: derived.estimatedPlanForHours,
    weekStartDay,
    weekTimeZone,
    strictness: 'somewhat_flexible',
    bufferPercent,
    preferredTone: null,
    professionType: 'full_time_employee',
    professionOtherText: null,
    hasJob: false,
    jobHoursPerWeek: 0,
    isStudent: false,
    classHoursPerWeek: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
};
