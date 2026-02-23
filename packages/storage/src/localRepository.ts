import {
  computeWeeklyCapacity,
  createDefaultSettings,
  domainSchema,
  getBufferPercentForStrictness,
  profileSchema,
  settingsSchema,
  weekLogSchema,
  weekPlanSchema,
  type Domain,
  type Profile,
  type Settings,
  type WeekLogEntry,
  type WeekPlan,
} from '@ikigai/core';
import { z } from 'zod';
import { createDb, IkigaiDB } from './db';
import type {
  DomainRepository,
  ProfileRepository,
  SettingsRepository,
  WeekLogRepository,
  WeekPlanRepository,
} from './repository';

const isDev = process.env.NODE_ENV !== 'production';

const parseOrThrow = <T>(schema: z.ZodType<T>, data: unknown, context: string): T => {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const message = `${context} failed validation: ${result.error.message}`;
  if (isDev) {
    throw new Error(message);
  }
  throw new Error('Invalid data in local storage.');
};

export class LocalRepository
  implements
    DomainRepository,
    SettingsRepository,
    ProfileRepository,
    WeekPlanRepository,
    WeekLogRepository
{
  private db: IkigaiDB;

  constructor(db: IkigaiDB) {
    this.db = db;
  }

  async listDomains(): Promise<Domain[]> {
    const domains = await this.db.domains.toArray();
    return parseOrThrow(z.array(domainSchema), domains, 'Domains');
  }

  async upsertDomain(domain: Domain): Promise<void> {
    const validated = parseOrThrow(domainSchema, domain, 'Domain');
    await this.db.domains.put(validated);
  }

  async archiveDomain(domainId: string): Promise<void> {
    const domain = await this.db.domains.get(domainId);
    if (!domain) {
      return;
    }
    const nowIso = new Date().toISOString();
    const updated: Domain = {
      ...domain,
      archivedAt: nowIso,
      updatedAt: nowIso,
    };
    const validated = parseOrThrow(domainSchema, updated, 'Domain archive');
    await this.db.domains.put(validated);
  }

  async getSettings(): Promise<Settings> {
    const existing = await this.db.settings.get('singleton');
    if (!existing) {
      const nowIso = new Date().toISOString();
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const defaults = createDefaultSettings(nowIso, timeZone, 'sunday');
      const validated = parseOrThrow(settingsSchema, defaults, 'Settings default');
      await this.db.settings.put(validated);
      return validated;
    }
    try {
      return parseOrThrow(settingsSchema, existing, 'Settings');
    } catch (error) {
      if (
        typeof existing === 'object' &&
        existing !== null &&
        (!('bufferPercent' in existing) ||
          !('preferredTone' in existing) ||
          !('weeklyCapacityHoursDerived' in existing) ||
          !('professionType' in existing) ||
          !('hasJob' in existing) ||
          !('jobHoursPerWeek' in existing) ||
          !('isStudent' in existing) ||
          !('classHoursPerWeek' in existing) ||
          !('weekStartDay' in existing) ||
          !('weekTimeZone' in existing)) &&
        'strictness' in existing
      ) {
        const nowIso = new Date().toISOString();
        const timeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const derived = computeWeeklyCapacity({
          sleepHoursPerDay:
            'sleepHoursPerDay' in (existing as Settings)
              ? (existing as Settings).sleepHoursPerDay
              : 8,
          maintenanceHoursPerDay:
            'maintenanceHoursPerDay' in (existing as Settings)
              ? (existing as Settings).maintenanceHoursPerDay
              : 1,
          jobHoursPerWeek:
            'jobHoursPerWeek' in (existing as Settings)
              ? Number((existing as Settings).jobHoursPerWeek)
              : 0,
          classHoursPerWeek:
            'classHoursPerWeek' in (existing as Settings)
              ? Number((existing as Settings).classHoursPerWeek)
              : 0,
          bufferPercent:
            'bufferPercent' in (existing as Settings)
              ? Number((existing as Settings).bufferPercent)
              : 30,
        });
        const repaired: Settings = {
          ...(existing as Settings),
          bufferPercent: getBufferPercentForStrictness(
            (existing as Settings).strictness,
          ),
          preferredTone:
            'preferredTone' in (existing as Settings)
              ? (existing as Settings).preferredTone
              : null,
          weeklyCapacityHoursDerived:
            'weeklyCapacityHoursDerived' in (existing as Settings)
              ? Number((existing as Settings).weeklyCapacityHoursDerived)
              : derived.estimatedPlanForHours,
          weekStartDay:
            'weekStartDay' in (existing as Settings)
              ? (existing as Settings).weekStartDay
              : 'sunday',
          weekTimeZone:
            'weekTimeZone' in (existing as Settings)
              ? (existing as Settings).weekTimeZone
              : timeZone,
          professionType:
            'professionType' in (existing as Settings)
              ? (existing as Settings).professionType
              : 'full_time_employee',
          professionOtherText:
            'professionOtherText' in (existing as Settings)
              ? (existing as Settings).professionOtherText ?? null
              : null,
          hasJob:
            'hasJob' in (existing as Settings)
              ? Boolean((existing as Settings).hasJob)
              : false,
          jobHoursPerWeek:
            'jobHoursPerWeek' in (existing as Settings)
              ? Number((existing as Settings).jobHoursPerWeek)
              : 0,
          isStudent:
            'isStudent' in (existing as Settings)
              ? Boolean((existing as Settings).isStudent)
              : false,
          classHoursPerWeek:
            'classHoursPerWeek' in (existing as Settings)
              ? Number((existing as Settings).classHoursPerWeek)
              : 0,
          updatedAt: nowIso,
        };
        const validated = parseOrThrow(settingsSchema, repaired, 'Settings repair');
        await this.db.settings.put(validated);
        return validated;
      }
      throw error;
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    const validated = parseOrThrow(settingsSchema, settings, 'Settings');
    await this.db.settings.put(validated);
  }

  async getProfile(): Promise<Profile | null> {
    const profiles = await this.db.profiles.toArray();
    if (profiles.length === 0) {
      return null;
    }
    const profile = profiles[0];
    try {
      return parseOrThrow(profileSchema, profile, 'Profile');
    } catch (error) {
      if (
        typeof profile === 'object' &&
        profile !== null &&
        !('reflections' in profile)
      ) {
        const nowIso = new Date().toISOString();
        const repaired: Profile = {
          ...(profile as Profile),
          reflections: [],
          updatedAt: nowIso,
        };
        const validated = parseOrThrow(profileSchema, repaired, 'Profile repair');
        await this.db.profiles.put(validated);
        return validated;
      }
      throw error;
    }
  }

  async saveProfile(profile: Profile): Promise<void> {
    const validated = parseOrThrow(profileSchema, profile, 'Profile');
    await this.db.profiles.put(validated);
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.db.profiles.delete(profileId);
  }

  async getWeekPlan(weekStartISO: string): Promise<WeekPlan | null> {
    const plan = await this.db.weekPlans.get(weekStartISO);
    if (!plan) {
      return null;
    }
    try {
      return parseOrThrow(weekPlanSchema, plan, 'WeekPlan');
    } catch (error) {
      if (typeof plan === 'object' && plan !== null && 'weekStartISO' in plan) {
        const timeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const start = new Date(`${(plan as WeekPlan).weekStartISO}T00:00:00`);
        start.setDate(start.getDate() + 6);
        const year = start.getFullYear();
        const month = `${start.getMonth() + 1}`.padStart(2, '0');
        const dayStr = `${start.getDate()}`.padStart(2, '0');
        const repaired: WeekPlan = {
          ...(plan as WeekPlan),
          weekEndISO:
            'weekEndISO' in (plan as WeekPlan)
              ? (plan as WeekPlan).weekEndISO
              : `${year}-${month}-${dayStr}`,
          weekStartDay:
            'weekStartDay' in (plan as WeekPlan)
              ? (plan as WeekPlan).weekStartDay
              : 'sunday',
          weekTimeZone:
            'weekTimeZone' in (plan as WeekPlan)
              ? (plan as WeekPlan).weekTimeZone
              : timeZone,
        };
        const validated = parseOrThrow(weekPlanSchema, repaired, 'WeekPlan repair');
        await this.db.weekPlans.put(validated);
        return validated;
      }
      throw error;
    }
  }

  async listWeekPlans(): Promise<WeekPlan[]> {
    const plans = await this.db.weekPlans.toArray();
    try {
      return parseOrThrow(z.array(weekPlanSchema), plans, 'WeekPlan list');
    } catch (error) {
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const repairedPlans = plans.map((plan) => {
        if (!plan || typeof plan !== 'object') {
          return plan as WeekPlan;
        }
        if ('weekEndISO' in plan && 'weekStartDay' in plan && 'weekTimeZone' in plan) {
          return plan as WeekPlan;
        }
        const startIso =
          'weekStartISO' in plan ? String((plan as WeekPlan).weekStartISO) : '';
        const startDate = new Date(`${startIso}T00:00:00`);
        startDate.setDate(startDate.getDate() + 6);
        const year = startDate.getFullYear();
        const month = `${startDate.getMonth() + 1}`.padStart(2, '0');
        const dayStr = `${startDate.getDate()}`.padStart(2, '0');
        return {
          ...(plan as WeekPlan),
          weekEndISO:
            'weekEndISO' in (plan as WeekPlan)
              ? (plan as WeekPlan).weekEndISO
              : `${year}-${month}-${dayStr}`,
          weekStartDay:
            'weekStartDay' in (plan as WeekPlan)
              ? (plan as WeekPlan).weekStartDay
              : 'sunday',
          weekTimeZone:
            'weekTimeZone' in (plan as WeekPlan)
              ? (plan as WeekPlan).weekTimeZone
              : timeZone,
        };
      });
      const validated = parseOrThrow(
        z.array(weekPlanSchema),
        repairedPlans,
        'WeekPlan list repair',
      );
      await this.db.weekPlans.bulkPut(validated);
      return validated;
    }
  }

  async saveWeekPlan(plan: WeekPlan): Promise<void> {
    const validated = parseOrThrow(weekPlanSchema, plan, 'WeekPlan');
    await this.db.weekPlans.put(validated);
  }

  async getWeekLogs(weekId: string): Promise<WeekLogEntry[]> {
    const logs = await this.db.weekLogs.where('weekId').equals(weekId).toArray();
    return parseOrThrow(z.array(weekLogSchema), logs, 'WeekLog list');
  }

  async saveWeekLog(entry: WeekLogEntry): Promise<void> {
    const validated = parseOrThrow(weekLogSchema, entry, 'WeekLog');
    await this.db.weekLogs.put(validated);
  }

  async resetOnboarding(): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.settings,
      this.db.profiles,
      this.db.weekPlans,
      this.db.weekLogs,
      async () => {
        await this.db.settings.clear();
        await this.db.profiles.clear();
        await this.db.weekPlans.clear();
        await this.db.weekLogs.clear();
      },
    );
  }
}

let cachedRepository: LocalRepository | null = null;

export const getLocalRepository = (): LocalRepository => {
  if (typeof window === 'undefined') {
    throw new Error('LocalRepository can only be used in the browser.');
  }
  if (!cachedRepository) {
    cachedRepository = new LocalRepository(createDb());
  }
  return cachedRepository;
};
