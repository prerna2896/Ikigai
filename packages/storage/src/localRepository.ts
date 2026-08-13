import {
  computeWeeklyCapacity,
  createDefaultSettings,
  domainSchema,
  getBufferPercentForStrictness,
  profileSchema,
  settingsSchema,
  suggestPrincipleForName,
  weekLogSchema,
  weekNoteSchema,
  weekPlanSchema,
  type Domain,
  type Profile,
  type Settings,
  type WeekLogEntry,
  type WeekNote,
  type WeekPlan,
} from '@ikigai/core';
import { z } from 'zod';
import { createDb, IkigaiDB, type PendingMutation } from './db';
import type {
  DomainRepository,
  ProfileRepository,
  SettingsRepository,
  WeekLogRepository,
  WeekNoteRepository,
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

// Fill missing domain fields on legacy WeekPlan records before Zod
// parses them. principleId was introduced after defaults were already
// in use, so existing rows can be missing it — backfill from the
// domain name using suggestPrincipleForName.
const repairWeekPlanRaw = (plan: unknown): unknown => {
  if (!plan || typeof plan !== 'object') return plan;
  const p = plan as Record<string, unknown>;
  const domains = Array.isArray(p.domains) ? p.domains : null;
  if (!domains) return plan;
  let didChange = false;
  const repairedDomains = domains.map((domain) => {
    if (!domain || typeof domain !== 'object') return domain;
    const d = domain as Record<string, unknown>;
    if (typeof d.principleId === 'string') return domain;
    didChange = true;
    const name = typeof d.name === 'string' ? d.name : '';
    return { ...d, principleId: suggestPrincipleForName(name) };
  });
  return didChange ? { ...p, domains: repairedDomains } : plan;
};

export class LocalRepository
  implements
    DomainRepository,
    SettingsRepository,
    ProfileRepository,
    WeekPlanRepository,
    WeekLogRepository,
    WeekNoteRepository
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
    const raw = await this.db.weekPlans.get(weekStartISO);
    if (!raw) {
      return null;
    }
    const plan = repairWeekPlanRaw(raw);
    const didRepair = plan !== raw;
    try {
      const validated = parseOrThrow(weekPlanSchema, plan, 'WeekPlan');
      if (didRepair) {
        await this.db.weekPlans.put(validated);
      }
      return validated;
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
    const raw = await this.db.weekPlans.toArray();
    const plans = raw.map(repairWeekPlanRaw);
    const didRepair = plans.some((p, i) => p !== raw[i]);
    try {
      const validated = parseOrThrow(
        z.array(weekPlanSchema),
        plans,
        'WeekPlan list',
      );
      if (didRepair) {
        await this.db.weekPlans.bulkPut(validated);
      }
      return validated;
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

  async deleteWeekPlan(weekId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.weekPlans, this.db.weekLogs, this.db.weekNotes],
      async () => {
        await this.db.weekPlans.delete(weekId);
        await this.db.weekLogs.where('weekId').equals(weekId).delete();
        await this.db.weekNotes.where('weekId').equals(weekId).delete();
      },
    );
  }

  async getWeekLogs(weekId: string): Promise<WeekLogEntry[]> {
    const logs = await this.db.weekLogs.where('weekId').equals(weekId).toArray();
    return parseOrThrow(z.array(weekLogSchema), logs, 'WeekLog list');
  }

  async saveWeekLog(entry: WeekLogEntry): Promise<void> {
    const validated = parseOrThrow(weekLogSchema, entry, 'WeekLog');
    await this.db.weekLogs.put(validated);
    await this.bumpProfileActivity(validated.updatedAt ?? validated.dateISO);
  }

  private async bumpProfileActivity(timestamp: string): Promise<void> {
    const existing = await this.db.profiles.toCollection().first();
    if (!existing) return;
    const next = {
      ...existing,
      lastActivityAt: timestamp,
      updatedAt: new Date().toISOString(),
    };
    const validated = parseOrThrow(profileSchema, next, 'Profile');
    await this.db.profiles.put(validated);
  }

  async getWeekNote(weekId: string): Promise<WeekNote | null> {
    const note = await this.db.weekNotes.where('weekId').equals(weekId).first();
    if (!note) {
      return null;
    }
    return parseOrThrow(weekNoteSchema, note, 'WeekNote');
  }

  async listWeekNotes(weekId: string): Promise<WeekNote[]> {
    const notes = await this.db.weekNotes
      .where('weekId')
      .equals(weekId)
      .toArray();
    return parseOrThrow(z.array(weekNoteSchema), notes, 'WeekNote list');
  }

  async saveWeekNote(note: WeekNote): Promise<void> {
    const validated = parseOrThrow(weekNoteSchema, note, 'WeekNote');
    await this.db.weekNotes.put(validated);
    await this.bumpProfileActivity(validated.updatedAt);
  }

  async resetAll(): Promise<void> {
    const tables = [
      this.db.settings,
      this.db.profiles,
      this.db.domains,
      this.db.weekPlans,
      this.db.weekLogs,
      this.db.weekNotes,
      this.db.weekDrafts,
      this.db.draftTasks,
      this.db.frozenWeeks,
      this.db.weekReviews,
    ];
    await this.db.transaction('rw', tables, async () => {
      await Promise.all(tables.map((table) => table.clear()));
    });
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

  // ─── Meta k/v (M4 migration marker + future one-off flags) ─────────────

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.meta.get(key);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  async listMetaKeys(prefix: string): Promise<string[]> {
    // Dexie primary keys are strings; startsWith range is the cheap way
    // to enumerate a namespace without a full-store scan on large stores.
    // The `meta` store is tiny so this is largely aesthetic here.
    return this.db.meta
      .where('key')
      .startsWith(prefix)
      .primaryKeys();
  }

  // ─── Pending mutations (offline write queue) ───────────────────────────
  //
  // Backs OfflineAwareCloudRepository. When a signed-in user makes a
  // write while offline (or the write fails with a network-shaped
  // error), we mirror the write to Dexie AND enqueue an entry here so
  // it can be replayed later. Ordering matters: replay is FIFO by
  // createdAt so that dependent mutations (e.g. saveWeekPlan then
  // saveWeekLog referencing tasks in that plan) don't get flipped and
  // fail on a missing FK.

  async enqueueMutation(
    entry: Omit<PendingMutation, 'id' | 'createdAt' | 'retries' | 'lastError'>,
  ): Promise<number> {
    const row = {
      createdAt: new Date().toISOString(),
      userId: entry.userId,
      op: entry.op,
      args: entry.args,
      retries: 0,
      lastError: null,
    } as Omit<PendingMutation, 'id'>;
    // Dexie's auto-increment PK returns the assigned id from add().
    return (await this.db.pending_mutations.add(row as PendingMutation)) as number;
  }

  async listPendingMutations(userId: string): Promise<PendingMutation[]> {
    // Filter by userId first (indexed), then sort — Dexie's `where`
    // returns a Collection that can be `.sortBy`'d in-memory. The queue
    // is expected to be small (≤ a few dozen rows), so in-memory sort
    // is fine and keeps the code simple.
    const rows = await this.db.pending_mutations
      .where('userId')
      .equals(userId)
      .toArray();
    rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return rows;
  }

  async removePendingMutation(id: number): Promise<void> {
    await this.db.pending_mutations.delete(id);
  }

  async updatePendingMutationError(id: number, error: string): Promise<void> {
    // Retries are incremented here (not at enqueue) so the queue drainer
    // owns the retry policy end-to-end. Callers only need to hand us
    // the error message.
    const existing = await this.db.pending_mutations.get(id);
    if (!existing) return;
    await this.db.pending_mutations.put({
      ...existing,
      retries: existing.retries + 1,
      lastError: error,
    });
  }

  async countPendingMutations(userId: string): Promise<number> {
    return this.db.pending_mutations.where('userId').equals(userId).count();
  }

  // Single-row lookup. Used by the pending-sync inspector UI when
  // taking an action on a specific queued row and needing to
  // double-check its current state (e.g. did the drainer succeed
  // between render and click).
  async getPendingMutation(id: number): Promise<PendingMutation | null> {
    const row = await this.db.pending_mutations.get(id);
    return row ?? null;
  }

  // "Discard" from the UI escape hatch. A user telling us to give up
  // on a poisoned entry is authoritative — we drop the queue row and
  // do NOT try to undo the Dexie mirror that was written when the
  // mutation was originally enqueued. Undoing the mirror is out of
  // scope: some ops (delete*) have no natural inverse and leaving the
  // mirror keeps the local view stable; the cloud row simply never
  // materializes.
  async deletePendingMutation(id: number): Promise<void> {
    await this.db.pending_mutations.delete(id);
  }

  // "Retry" from the UI escape hatch. Resets the retry counter and
  // clears lastError so the next drainer tick treats the entry as
  // fresh — the drainer's per-tick "skip past MAX_RETRIES" check will
  // no longer skip it. We do NOT drain synchronously here: keeping
  // drain scheduling centralized in queueDrain avoids two code paths
  // racing to replay the same row.
  async retryPendingMutation(id: number): Promise<void> {
    const existing = await this.db.pending_mutations.get(id);
    if (!existing) return;
    await this.db.pending_mutations.put({
      ...existing,
      retries: 0,
      lastError: null,
    });
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
