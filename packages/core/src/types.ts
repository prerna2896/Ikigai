export type Domain = {
  id: string; // uuid
  name: string;
  colorToken: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  archivedAt?: string | null;
};

export type Settings = {
  id: 'singleton';
  sleepHoursPerDay: number; // default 8
  maintenanceHoursPerDay: number; // default 1
  weeklyCapacityHours: number; // preferred
  weeklyCapacityHoursDerived: number;
  bufferPercent: number; // derived from strictness
  weekStartDay:
    | 'sunday'
    | 'monday'
    | 'tuesday'
    | 'wednesday'
    | 'thursday'
    | 'friday'
    | 'saturday';
  weekTimeZone: string;
  preferredTone: 'calm_spacious' | 'structured_grounding' | 'light_exploratory' | null;
  professionType:
    | 'full_time_employee'
    | 'part_time_employee'
    | 'founder_self_employed'
    | 'student'
    | 'looking_for_work'
    | 'caregiver'
    | 'break_sabbatical'
    | 'other';
  professionOtherText?: string | null;
  hasJob: boolean;
  jobHoursPerWeek: number;
  isStudent: boolean;
  classHoursPerWeek: number;
  strictness:
    | 'very_flexible'
    | 'somewhat_flexible'
    | 'structured'
    | 'very_structured';
  createdAt: string;
  updatedAt: string;
};

export type Profile = {
  id: string; // uuid
  name: string;
  reflections: ProfileReflection[];
  createdAt: string;
  updatedAt: string;
};

export type ProfileReflection = {
  questionId: string;
  answer: string;
};

export type WeekDraft = {
  weekId: string; // e.g. "2026-W05"
  state: 'draft';
  activeDomainIds: string[]; // max length 7
  weeklyCapacityMinutes: number;
  bufferPercent: number;
  sleepMinutesPerDay: number;
  maintenanceMinutesPerDay: number;
  createdAt: string;
  updatedAt: string;
};

export type DraftTask = {
  id: string;
  weekId: string;
  title: string;
  domainId: string;
  plannedMinutes: number;
  ikigaiTags: ('energy' | 'growth' | 'contribution' | 'alignment')[];
  isRoutine: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FrozenWeekSnapshot = {
  weekId: string;
  frozenAt: string;
  activeDomainIds: string[];
  plannedMinutesByDomain: Record<string, number>;
  plannedMinutesTotal: number;
};

export type WeekReview = {
  weekId: string;
  actualMinutesByDomain: Record<string, number>;
  completionByDomain: Record<string, number>;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type DomainTask = {
  id: string;
  title: string;
  plannedHours: number;
  actualHours?: number;
  tags?: string[];
};

export type WeekDomain = {
  id: string;
  name: string;
  colorKey: string;
  plannedHours: number;
  tasks: DomainTask[];
};

export type WeekPlan = {
  id: string;
  weekStartISO: string;
  weekEndISO: string;
  weekStartDay:
    | 'sunday'
    | 'monday'
    | 'tuesday'
    | 'wednesday'
    | 'thursday'
    | 'friday'
    | 'saturday';
  weekTimeZone: string;
  createdAtISO: string;
  domains: WeekDomain[];
  isFrozen: boolean;
};

export type WeekLogEntry = {
  id: string;
  weekId: string;
  dateISO: string;
  taskHours: Record<string, number>;
  createdAt: string;
  updatedAt: string;
};
