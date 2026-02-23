import Dexie, { type Table } from 'dexie';
import type {
  Domain,
  Profile,
  Settings,
  WeekPlan,
  WeekLogEntry,
  WeekDraft,
  DraftTask,
  FrozenWeekSnapshot,
  WeekReview,
} from '@ikigai/core';

const schemaV1 = {
  domains: 'id, name, archivedAt, colorToken, createdAt, updatedAt',
  settings:
    'id, sleepHoursPerDay, maintenanceHoursPerDay, weeklyCapacityHours, bufferPercent, strictness, createdAt, updatedAt',
  weekDrafts: 'weekId, state, createdAt, updatedAt',
  draftTasks: 'id, weekId, domainId, createdAt, updatedAt',
  frozenWeeks: 'weekId, frozenAt',
  weekReviews: 'weekId, createdAt, updatedAt',
};

const schemaV2 = {
  ...schemaV1,
  profiles: 'id, name, createdAt, updatedAt',
};

const schemaV3 = {
  ...schemaV2,
  profiles: 'id, name, createdAt, updatedAt',
};

const schemaV4 = {
  ...schemaV3,
  settings:
    'id, sleepHoursPerDay, maintenanceHoursPerDay, weeklyCapacityHours, bufferPercent, preferredTone, strictness, createdAt, updatedAt',
};

const schemaV5 = {
  ...schemaV4,
  settings:
    'id, sleepHoursPerDay, maintenanceHoursPerDay, weeklyCapacityHours, weeklyCapacityHoursDerived, bufferPercent, preferredTone, professionType, professionOtherText, hasJob, jobHoursPerWeek, isStudent, classHoursPerWeek, strictness, createdAt, updatedAt',
};

const schemaV6 = {
  ...schemaV5,
  weekPlans: 'id, weekStartISO, createdAtISO, isFrozen',
};

const schemaV7 = {
  ...schemaV6,
  settings:
    'id, sleepHoursPerDay, maintenanceHoursPerDay, weeklyCapacityHours, weeklyCapacityHoursDerived, bufferPercent, weekStartDay, weekTimeZone, preferredTone, professionType, professionOtherText, hasJob, jobHoursPerWeek, isStudent, classHoursPerWeek, strictness, createdAt, updatedAt',
  weekPlans: 'id, weekStartISO, weekEndISO, weekStartDay, weekTimeZone, createdAtISO, isFrozen',
};

const schemaV8 = {
  ...schemaV7,
  weekLogs: 'id, weekId, dateISO, createdAt, updatedAt',
};

export class IkigaiDB extends Dexie {
  domains!: Table<Domain, string>;
  settings!: Table<Settings, string>;
  profiles!: Table<Profile, string>;
  weekPlans!: Table<WeekPlan, string>;
  weekLogs!: Table<WeekLogEntry, string>;
  weekDrafts!: Table<WeekDraft, string>;
  draftTasks!: Table<DraftTask, string>;
  frozenWeeks!: Table<FrozenWeekSnapshot, string>;
  weekReviews!: Table<WeekReview, string>;

  constructor() {
    super('ikigai');
    this.version(1).stores(schemaV1);
    this.version(2).stores(schemaV2);
    this.version(3).stores(schemaV3);
    this.version(4).stores(schemaV4);
    this.version(5).stores(schemaV5);
    this.version(6).stores(schemaV6);
    this.version(7).stores(schemaV7);
    this.version(8).stores(schemaV8);
  }
}

export const createDb = () => new IkigaiDB();
