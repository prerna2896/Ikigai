import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  pgSchema,
  primaryKey,
} from 'drizzle-orm/pg-core';

// Reference to Supabase's built-in auth.users table.
// We only need the shape of `id` for FK targeting; Supabase owns the rest.
const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});

// Common column set used by every user-scoped table. Kept as a factory
// (not spread) so tables can override defaults if needed.
const auditColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  version: integer('version').notNull().default(1),
});

// ─── profiles ────────────────────────────────────────────────────────────
// One row per user. user_id doubles as PK — natural per-user singleton.
export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  lifeAreas: text('life_areas').array(),
  lastActivityAt: timestamp('last_activity_at', {
    withTimezone: true,
    mode: 'string',
  }),
  ...auditColumns(),
});

// ─── profile_reflections ─────────────────────────────────────────────────
export const profileReflections = pgTable(
  'profile_reflections',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    answer: text('answer').notNull(),
    ...auditColumns(),
  },
  (t) => ({
    userQuestionUniq: uniqueIndex('profile_reflections_user_question_key').on(
      t.userId,
      t.questionId,
    ),
  }),
);

// ─── profile_goals ───────────────────────────────────────────────────────
export const profileGoals = pgTable('profile_goals', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  timeline: text('timeline').notNull(),
  ...auditColumns(),
});

// ─── settings ────────────────────────────────────────────────────────────
// user_id as PK — one settings row per user. Mirrors Settings 'singleton'
// pattern in packages/core.
export const settings = pgTable('settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  sleepHoursPerDay: numeric('sleep_hours_per_day', {
    precision: 4,
    scale: 2,
  })
    .notNull()
    .default('8'),
  maintenanceHoursPerDay: numeric('maintenance_hours_per_day', {
    precision: 4,
    scale: 2,
  })
    .notNull()
    .default('1'),
  weeklyCapacityHours: numeric('weekly_capacity_hours', {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default('40'),
  weeklyCapacityHoursDerived: numeric('weekly_capacity_hours_derived', {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default('40'),
  bufferPercent: integer('buffer_percent').notNull().default(20),
  weekStartDay: text('week_start_day').notNull().default('monday'),
  weekTimeZone: text('week_time_zone').notNull().default('UTC'),
  preferredTone: text('preferred_tone'),
  professionType: text('profession_type').notNull().default('other'),
  professionOtherText: text('profession_other_text'),
  hasJob: boolean('has_job').notNull().default(false),
  jobHoursPerWeek: numeric('job_hours_per_week', {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default('0'),
  isStudent: boolean('is_student').notNull().default(false),
  classHoursPerWeek: numeric('class_hours_per_week', {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default('0'),
  strictness: text('strictness').notNull().default('structured'),
  checkInFrequency: text('check_in_frequency'),
  planningFrequency: text('planning_frequency'),
  ...auditColumns(),
});

// ─── domains ─────────────────────────────────────────────────────────────
// Cross-week domain catalog. Not currently used cross-week by the app but
// kept in schema for future features.
export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colorToken: text('color_token').notNull(),
    archivedAt: timestamp('archived_at', {
      withTimezone: true,
      mode: 'string',
    }),
    ...auditColumns(),
  },
  (t) => ({
    userIdx: index('domains_user_idx').on(t.userId),
  }),
);

// ─── week_plans ──────────────────────────────────────────────────────────
// id is stored as text, not uuid. The local WeekPlan.id is the
// weekStartISO date (`2026-08-04`), not a UUID — see
// packages/core createDefaultWeekPlan. Keeping the shape identical
// across Local (Dexie) and Cloud (Postgres) avoids translation at the
// repository boundary and keeps URLs like /week/2026-08-04 stable.
export const weekPlans = pgTable(
  'week_plans',
  {
    // id is text (typically weekStartISO like '2026-08-10'). The
    // primary key is composite (user_id, id) — see migration
    // 0003_week_plans_composite_pk.sql — so each user has their own
    // namespace for plan ids. A global PK would prevent user B from
    // ever having a plan for the same week user A already planned.
    id: text('id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    weekStartIso: date('week_start_iso').notNull(),
    weekEndIso: date('week_end_iso').notNull(),
    weekStartDay: text('week_start_day').notNull(),
    weekTimeZone: text('week_time_zone').notNull(),
    isFrozen: boolean('is_frozen').notNull().default(false),
    ...auditColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.id] }),
    userWeekUniq: uniqueIndex('week_plans_user_week_key').on(
      t.userId,
      t.weekStartIso,
    ),
    userWeekIdx: index('week_plans_user_week_idx').on(
      t.userId,
      t.weekStartIso,
    ),
  }),
);

// ─── week_domains ────────────────────────────────────────────────────────
// Denormalized user_id so RLS check is a single-column comparison, no join
// needed to prove ownership.
export const weekDomains = pgTable(
  'week_domains',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    weekPlanId: text('week_plan_id')
      .notNull()
      .references(() => weekPlans.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colorKey: text('color_key').notNull(),
    principleId: text('principle_id').notNull(),
    position: integer('position').notNull().default(0),
    ...auditColumns(),
  },
  (t) => ({
    planIdx: index('week_domains_plan_idx').on(t.weekPlanId),
    userIdx: index('week_domains_user_idx').on(t.userId),
  }),
);

// ─── week_tasks ──────────────────────────────────────────────────────────
export const weekTasks = pgTable(
  'week_tasks',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    weekPlanId: text('week_plan_id')
      .notNull()
      .references(() => weekPlans.id, { onDelete: 'cascade' }),
    weekDomainId: uuid('week_domain_id')
      .notNull()
      .references(() => weekDomains.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    plannedHours: numeric('planned_hours', { precision: 6, scale: 2 })
      .notNull()
      .default('0'),
    position: integer('position').notNull().default(0),
    tags: text('tags').array(),
    // Independent of hours_logged — logging 2h of a 4h task doesn't
    // imply completion, and marking done doesn't auto-log the
    // remaining hours. See migration 0004.
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'string',
    }),
    ...auditColumns(),
  },
  (t) => ({
    domainIdx: index('week_tasks_domain_idx').on(t.weekDomainId),
    userIdx: index('week_tasks_user_idx').on(t.userId),
  }),
);

// ─── week_goals ──────────────────────────────────────────────────────────
export const weekGoals = pgTable(
  'week_goals',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    weekPlanId: text('week_plan_id')
      .notNull()
      .references(() => weekPlans.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'string',
    }),
    position: integer('position').notNull().default(0),
    ...auditColumns(),
  },
  (t) => ({
    planIdx: index('week_goals_plan_idx').on(t.weekPlanId),
  }),
);

// ─── hours_logged ────────────────────────────────────────────────────────
// Flat, analytics-friendly. One row per (user, task, date).
// M3 aggregation queries (trend / rollup) hit this table.
export const hoursLogged = pgTable(
  'hours_logged',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    // Nullable: an unplanned task logged after-the-fact has no week_tasks row.
    taskId: uuid('task_id').references(() => weekTasks.id, {
      onDelete: 'cascade',
    }),
    // Denormalized week_plan_id so trend queries can filter by week without
    // joining through week_tasks. Nullable for the same unplanned reason.
    weekPlanId: text('week_plan_id').references(() => weekPlans.id, {
      onDelete: 'cascade',
    }),
    // Free-form task title captured at log time; useful when task_id is null.
    unplannedTitle: text('unplanned_title'),
    dateIso: date('date_iso').notNull(),
    hours: numeric('hours', { precision: 5, scale: 2 }).notNull(),
    ...auditColumns(),
  },
  (t) => ({
    // A planned task can only have one hours entry per date (idempotent
    // upsert key). Partial unique so unplanned entries (task_id null) don't
    // collide with each other on the same date.
    userTaskDateUniq: uniqueIndex('hours_logged_user_task_date_key')
      .on(t.userId, t.taskId, t.dateIso)
      .where(sql`task_id IS NOT NULL`),
    userDateIdx: index('hours_logged_user_date_idx').on(t.userId, t.dateIso),
    userWeekIdx: index('hours_logged_user_week_idx').on(
      t.userId,
      t.weekPlanId,
    ),
  }),
);

// ─── week_notes ──────────────────────────────────────────────────────────
export const weekNotes = pgTable(
  'week_notes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    weekPlanId: text('week_plan_id')
      .notNull()
      .references(() => weekPlans.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    ...auditColumns(),
  },
  (t) => ({
    planIdx: index('week_notes_plan_idx').on(t.weekPlanId),
  }),
);

// ─── pending_mutations (server-side sync log) ────────────────────────────
// Audit of mutations replayed from an offline client. Used by M2 for
// offline-queue debugging.
export const pendingMutations = pgTable(
  'pending_mutations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    op: text('op').notNull(),
    payload: jsonb('payload').notNull(),
    appliedAt: timestamp('applied_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('pending_mutations_user_idx').on(t.userId, t.createdAt),
  }),
);

// Manifest — a single list of every user-scoped table.
// The static policy audit (supabase/scripts/audit-rls.sql) diffs this
// manifest against pg_policies to prove full policy coverage on every
// user_id table. Adding a new user-scoped table without appending here
// will fail the audit — that's the regression gate.
export const USER_SCOPED_TABLES = [
  'profiles',
  'profile_reflections',
  'profile_goals',
  'settings',
  'domains',
  'week_plans',
  'week_domains',
  'week_tasks',
  'week_goals',
  'hours_logged',
  'week_notes',
  'pending_mutations',
] as const;
