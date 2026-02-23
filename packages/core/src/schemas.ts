import { z } from 'zod';
import { DOMAIN_COLOR_TOKENS } from './constants';

const isoDateString = z.string().datetime({ offset: true });
const nonNegativeNumber = z.number().min(0);

export const domainSchema = z.object({
  id: z.string(),
  name: z.string(),
  colorToken: z.enum(DOMAIN_COLOR_TOKENS),
  createdAt: isoDateString,
  updatedAt: isoDateString,
  archivedAt: isoDateString.nullable().optional(),
});

export const settingsSchema = z.object({
  id: z.literal('singleton'),
  sleepHoursPerDay: nonNegativeNumber,
  maintenanceHoursPerDay: nonNegativeNumber,
  weeklyCapacityHours: nonNegativeNumber,
  weeklyCapacityHoursDerived: nonNegativeNumber,
  bufferPercent: nonNegativeNumber,
  weekStartDay: z.enum([
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]),
  weekTimeZone: z.string(),
  preferredTone: z
    .enum(['calm_spacious', 'structured_grounding', 'light_exploratory'])
    .nullable(),
  professionType: z.enum([
    'full_time_employee',
    'part_time_employee',
    'founder_self_employed',
    'student',
    'looking_for_work',
    'caregiver',
    'break_sabbatical',
    'other',
  ]),
  professionOtherText: z.string().nullable().optional(),
  hasJob: z.boolean(),
  jobHoursPerWeek: nonNegativeNumber,
  isStudent: z.boolean(),
  classHoursPerWeek: nonNegativeNumber,
  strictness: z.enum([
    'very_flexible',
    'somewhat_flexible',
    'structured',
    'very_structured',
  ]),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

export const weekDraftSchema = z.object({
  weekId: z.string(),
  state: z.literal('draft'),
  activeDomainIds: z.array(z.string()).max(7),
  weeklyCapacityMinutes: nonNegativeNumber,
  bufferPercent: nonNegativeNumber,
  sleepMinutesPerDay: nonNegativeNumber,
  maintenanceMinutesPerDay: nonNegativeNumber,
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

export const draftTaskSchema = z.object({
  id: z.string(),
  weekId: z.string(),
  title: z.string(),
  domainId: z.string(),
  plannedMinutes: nonNegativeNumber,
  ikigaiTags: z.array(
    z.enum(['energy', 'growth', 'contribution', 'alignment']),
  ),
  isRoutine: z.boolean(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

export const frozenWeekSnapshotSchema = z.object({
  weekId: z.string(),
  frozenAt: isoDateString,
  activeDomainIds: z.array(z.string()),
  plannedMinutesByDomain: z.record(nonNegativeNumber),
  plannedMinutesTotal: nonNegativeNumber,
});

export const weekReviewSchema = z.object({
  weekId: z.string(),
  actualMinutesByDomain: z.record(nonNegativeNumber),
  completionByDomain: z.record(nonNegativeNumber),
  note: z.string().optional(),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

export const domainTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  plannedHours: nonNegativeNumber,
  actualHours: nonNegativeNumber.optional(),
  tags: z.array(z.string()).optional(),
});

export const weekDomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  colorKey: z.string(),
  plannedHours: nonNegativeNumber,
  tasks: z.array(domainTaskSchema),
});

export const weekPlanSchema = z.object({
  id: z.string(),
  weekStartISO: z.string(),
  weekEndISO: z.string(),
  weekStartDay: z.enum([
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]),
  weekTimeZone: z.string(),
  createdAtISO: isoDateString,
  domains: z.array(weekDomainSchema).max(7),
  isFrozen: z.boolean(),
});

export const weekLogSchema = z.object({
  id: z.string(),
  weekId: z.string(),
  dateISO: isoDateString,
  taskHours: z.record(nonNegativeNumber),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  reflections: z.array(
    z.object({
      questionId: z.string(),
      answer: z.string(),
    }),
  ),
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

export type DomainInput = z.infer<typeof domainSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type WeekDraftInput = z.infer<typeof weekDraftSchema>;
export type DraftTaskInput = z.infer<typeof draftTaskSchema>;
export type FrozenWeekSnapshotInput = z.infer<typeof frozenWeekSnapshotSchema>;
export type WeekReviewInput = z.infer<typeof weekReviewSchema>;
export type DomainTaskInput = z.infer<typeof domainTaskSchema>;
export type WeekDomainInput = z.infer<typeof weekDomainSchema>;
export type WeekPlanInput = z.infer<typeof weekPlanSchema>;
export type WeekLogInput = z.infer<typeof weekLogSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
