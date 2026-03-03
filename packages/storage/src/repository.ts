import type {
  Domain,
  Profile,
  Settings,
  WeekLogEntry,
  WeekNote,
  WeekPlan,
} from '@ikigai/core';

export interface DomainRepository {
  listDomains(): Promise<Domain[]>;
  upsertDomain(domain: Domain): Promise<void>;
  archiveDomain(domainId: string): Promise<void>;
}

export interface SettingsRepository {
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
}

export interface ProfileRepository {
  getProfile(): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;
  deleteProfile(profileId: string): Promise<void>;
}

export interface WeekPlanRepository {
  getWeekPlan(weekStartISO: string): Promise<WeekPlan | null>;
  listWeekPlans(): Promise<WeekPlan[]>;
  saveWeekPlan(plan: WeekPlan): Promise<void>;
}

export interface WeekLogRepository {
  getWeekLogs(weekId: string): Promise<WeekLogEntry[]>;
  saveWeekLog(entry: WeekLogEntry): Promise<void>;
}

export interface WeekNoteRepository {
  getWeekNote(weekId: string): Promise<WeekNote | null>;
  saveWeekNote(note: WeekNote): Promise<void>;
}
