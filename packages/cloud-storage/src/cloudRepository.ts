import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createDefaultSettings,
  profileSchema,
  settingsSchema,
  type Profile,
  type ProfileReflection,
  type ProfileGoal,
  type Settings,
  type WeekPlan,
  type WeekDomain,
  type DomainTask,
  type WeekGoal,
  type WeekLogEntry,
  type WeekNote,
} from '@ikigai/core';
import type {
  ProfileRepository,
  SettingsRepository,
  WeekPlanRepository,
  WeekLogRepository,
  WeekNoteRepository,
} from '@ikigai/storage';

// Cloud-backed implementation of ProfileRepository + SettingsRepository.
//
// Uses the browser Supabase client — every request carries the user's
// JWT, so RLS policies (verified in M1) enforce isolation. Callers
// don't specify user_id; we derive it from the session on write and
// pull `auth.uid()` implicitly on read.
//
// Shape mapping:
//   - Local Profile has id (uuid), reflections[], goals[] all in one object.
//     Cloud stores profile in `profiles` table, reflections in
//     `profile_reflections`, goals in `profile_goals` — three joined
//     tables. Our getProfile does the fan-out reads and stitches
//     back into the Profile shape (using userId as Profile.id).
//   - Local Settings has id: 'singleton'. Cloud stores one row per
//     user (user_id is PK). We reconstruct id: 'singleton' on read.
//   - Numeric columns come back from Supabase JS as strings (numeric
//     type). We Number() them at the boundary.

const numOr = (
  v: string | number | null | undefined,
  fallback: number,
): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '') {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

async function currentUserId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error(
      'CloudRepository requires an authenticated user; got none.',
    );
  }
  return data.user.id;
}

export class CloudRepository
  implements
    ProfileRepository,
    SettingsRepository,
    WeekPlanRepository,
    WeekLogRepository,
    WeekNoteRepository
{
  constructor(private readonly supabase: SupabaseClient) {}

  // ─── Profile ───────────────────────────────────────────────────────────

  async getProfile(): Promise<Profile | null> {
    const userId = await currentUserId(this.supabase);

    // Three-way read. RLS filters each table to the caller's rows.
    const [profileRes, reflectionsRes, goalsRes] = await Promise.all([
      this.supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
      this.supabase
        .from('profile_reflections')
        .select('question_id, answer')
        .eq('user_id', userId),
      this.supabase
        .from('profile_goals')
        .select('text, timeline, created_at')
        .eq('user_id', userId),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (reflectionsRes.error) throw reflectionsRes.error;
    if (goalsRes.error) throw goalsRes.error;

    const row = profileRes.data;
    if (!row) return null;

    const reflections: ProfileReflection[] = (reflectionsRes.data ?? []).map(
      (r) => ({
        questionId: r.question_id,
        answer: r.answer,
      }),
    );
    const goals: ProfileGoal[] = (goalsRes.data ?? []).map((g) => ({
      text: g.text,
      timeline: g.timeline,
      createdAt: g.created_at,
    }));

    const profile: Profile = {
      // Local Profile.id was a UUID; here we surface user_id in its
      // place so downstream code has *some* stable id. Callers that
      // care about it (rare) get a per-user-stable value.
      id: userId,
      name: row.name,
      reflections,
      lifeAreas: row.life_areas ?? undefined,
      goals: goals.length ? goals : undefined,
      lastActivityAt: row.last_activity_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return profileSchema.parse(profile);
  }

  async saveProfile(profile: Profile): Promise<void> {
    const userId = await currentUserId(this.supabase);
    profileSchema.parse(profile);

    // Upsert the parent row.
    const now = new Date().toISOString();
    const { error: profileErr } = await this.supabase.from('profiles').upsert(
      {
        user_id: userId,
        name: profile.name,
        life_areas: profile.lifeAreas ?? null,
        last_activity_at: profile.lastActivityAt ?? null,
        created_at: profile.createdAt || now,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    );
    if (profileErr) throw profileErr;

    // Replace reflections wholesale. Wipe then insert — simpler than
    // diffing, and reflections are small.
    await this.supabase
      .from('profile_reflections')
      .delete()
      .eq('user_id', userId);
    if (profile.reflections.length > 0) {
      const { error } = await this.supabase
        .from('profile_reflections')
        .insert(
          profile.reflections.map((r) => ({
            id: crypto.randomUUID(),
            user_id: userId,
            question_id: r.questionId,
            answer: r.answer,
          })),
        );
      if (error) throw error;
    }

    // Same wipe-then-insert for goals.
    await this.supabase
      .from('profile_goals')
      .delete()
      .eq('user_id', userId);
    if (profile.goals && profile.goals.length > 0) {
      const { error } = await this.supabase.from('profile_goals').insert(
        profile.goals.map((g) => ({
          id: crypto.randomUUID(),
          user_id: userId,
          text: g.text,
          timeline: g.timeline,
          created_at: g.createdAt,
        })),
      );
      if (error) throw error;
    }
  }

  async deleteProfile(_profileId: string): Promise<void> {
    // We ignore _profileId — RLS + user_id PK means the only profile
    // the caller can touch is their own. Cascade delete handles
    // reflections/goals via FK.
    const userId = await currentUserId(this.supabase);
    const { error } = await this.supabase
      .from('profiles')
      .delete()
      .eq('user_id', userId);
    if (error) throw error;
  }

  // ─── Settings ──────────────────────────────────────────────────────────

  async getSettings(): Promise<Settings> {
    const userId = await currentUserId(this.supabase);

    const { data, error } = await this.supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      // Bootstrap: no row yet → save defaults so subsequent reads are
      // cheap and stable.
      const nowIso = new Date().toISOString();
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const defaults = createDefaultSettings(nowIso, timeZone, 'sunday');
      await this.saveSettings(defaults);
      return defaults;
    }

    const settings: Settings = {
      id: 'singleton',
      sleepHoursPerDay: numOr(data.sleep_hours_per_day, 8),
      maintenanceHoursPerDay: numOr(data.maintenance_hours_per_day, 1),
      weeklyCapacityHours: numOr(data.weekly_capacity_hours, 40),
      weeklyCapacityHoursDerived: numOr(
        data.weekly_capacity_hours_derived,
        40,
      ),
      bufferPercent: numOr(data.buffer_percent, 20),
      weekStartDay: data.week_start_day,
      weekTimeZone: data.week_time_zone,
      preferredTone: data.preferred_tone,
      professionType: data.profession_type,
      professionOtherText: data.profession_other_text,
      hasJob: data.has_job,
      jobHoursPerWeek: numOr(data.job_hours_per_week, 0),
      isStudent: data.is_student,
      classHoursPerWeek: numOr(data.class_hours_per_week, 0),
      strictness: data.strictness,
      checkInFrequency: data.check_in_frequency ?? undefined,
      planningFrequency: data.planning_frequency ?? undefined,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };

    return settingsSchema.parse(settings);
  }

  async saveSettings(settings: Settings): Promise<void> {
    const userId = await currentUserId(this.supabase);
    settingsSchema.parse(settings);

    const now = new Date().toISOString();
    const { error } = await this.supabase.from('settings').upsert(
      {
        user_id: userId,
        sleep_hours_per_day: settings.sleepHoursPerDay,
        maintenance_hours_per_day: settings.maintenanceHoursPerDay,
        weekly_capacity_hours: settings.weeklyCapacityHours,
        weekly_capacity_hours_derived: settings.weeklyCapacityHoursDerived,
        buffer_percent: settings.bufferPercent,
        week_start_day: settings.weekStartDay,
        week_time_zone: settings.weekTimeZone,
        preferred_tone: settings.preferredTone,
        profession_type: settings.professionType,
        profession_other_text: settings.professionOtherText,
        has_job: settings.hasJob,
        job_hours_per_week: settings.jobHoursPerWeek,
        is_student: settings.isStudent,
        class_hours_per_week: settings.classHoursPerWeek,
        strictness: settings.strictness,
        check_in_frequency: settings.checkInFrequency ?? null,
        planning_frequency: settings.planningFrequency ?? null,
        created_at: settings.createdAt || now,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  }

  // ─── WeekPlan ──────────────────────────────────────────────────────────
  //
  // A WeekPlan is stitched from 4 tables (plan + domains + tasks + goals).
  // Reads: parent lookup, then parallel child fetches, then in-memory join.
  // Writes: upsert parent, wipe child rows for the plan, insert fresh
  //         child rows. Wipe-and-insert is heavy per save (~50 rows for a
  //         full week) but is atomic-enough for our per-blur save cadence.
  //         M2.4's sync engine formalizes finer-grained mutations.

  private async fetchPlanWithChildren(
    planRow: Record<string, unknown>,
  ): Promise<WeekPlan> {
    const planId = planRow.id as string;
    const [domainsRes, tasksRes, goalsRes] = await Promise.all([
      this.supabase
        .from('week_domains')
        .select('*')
        .eq('week_plan_id', planId)
        .order('position', { ascending: true }),
      this.supabase
        .from('week_tasks')
        .select('*')
        .eq('week_plan_id', planId)
        .order('position', { ascending: true }),
      this.supabase
        .from('week_goals')
        .select('*')
        .eq('week_plan_id', planId)
        .order('position', { ascending: true }),
    ]);
    if (domainsRes.error) throw domainsRes.error;
    if (tasksRes.error) throw tasksRes.error;
    if (goalsRes.error) throw goalsRes.error;

    const tasksByDomain = new Map<string, DomainTask[]>();
    for (const t of tasksRes.data ?? []) {
      const domainId = t.week_domain_id as string;
      const list = tasksByDomain.get(domainId) ?? [];
      list.push({
        id: t.id,
        title: t.title,
        plannedHours: numOr(t.planned_hours, 0),
        tags: t.tags ?? undefined,
        completedAt: (t.completed_at as string | null | undefined) ?? null,
      });
      tasksByDomain.set(domainId, list);
    }

    const domains: WeekDomain[] = (domainsRes.data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      colorKey: d.color_key,
      // plannedHours is a derived field. The UI recomputes it via
      // withDerivedPlannedHours() from the task list, so 0 here is
      // fine — the moment the plan hits state it gets re-derived.
      plannedHours: 0,
      principleId: d.principle_id,
      tasks: tasksByDomain.get(d.id) ?? [],
    }));

    const goals: WeekGoal[] = (goalsRes.data ?? []).map((g) => ({
      id: g.id,
      text: g.text,
      completedAt: g.completed_at ?? undefined,
    }));

    return {
      id: planRow.id as string,
      weekStartISO: planRow.week_start_iso as string,
      weekEndISO: planRow.week_end_iso as string,
      weekStartDay: planRow.week_start_day as WeekPlan['weekStartDay'],
      weekTimeZone: planRow.week_time_zone as string,
      createdAtISO: planRow.created_at as string,
      domains,
      goals: goals.length > 0 ? goals : undefined,
      isFrozen: Boolean(planRow.is_frozen),
    };
  }

  async getWeekPlan(weekStartISO: string): Promise<WeekPlan | null> {
    const userId = await currentUserId(this.supabase);
    const { data, error } = await this.supabase
      .from('week_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start_iso', weekStartISO)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return this.fetchPlanWithChildren(data);
  }

  async listWeekPlans(): Promise<WeekPlan[]> {
    const userId = await currentUserId(this.supabase);
    const { data, error } = await this.supabase
      .from('week_plans')
      .select('*')
      .eq('user_id', userId)
      .order('week_start_iso', { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) return [];
    // Fan out reads per plan. For a user with 100 plans, this is 300
    // extra queries — acceptable for now, revisit with a batched
    // fetch (json_agg or a single JOIN query) if listWeekPlans() gets
    // called on a hot path.
    return Promise.all(data.map((row) => this.fetchPlanWithChildren(row)));
  }

  async saveWeekPlan(plan: WeekPlan): Promise<void> {
    const userId = await currentUserId(this.supabase);
    const now = new Date().toISOString();

    const { error: planErr } = await this.supabase.from('week_plans').upsert(
      {
        id: plan.id,
        user_id: userId,
        week_start_iso: plan.weekStartISO,
        week_end_iso: plan.weekEndISO,
        week_start_day: plan.weekStartDay,
        week_time_zone: plan.weekTimeZone,
        is_frozen: plan.isFrozen,
        created_at: plan.createdAtISO || now,
        updated_at: now,
      },
      // week_plans has a composite PK (user_id, id). The
      // onConflict target must include both to trigger the correct
      // ON CONFLICT DO UPDATE path.
      { onConflict: 'user_id,id' },
    );
    if (planErr) throw planErr;

    // UPSERT + delete-missing, NOT wipe-and-reinsert.
    //
    // The old code did DELETE FROM week_domains WHERE week_plan_id = X
    // and let the FK cascade sweep week_tasks. But hours_logged.task_id
    // also has an ON DELETE CASCADE FK to week_tasks — so wiping the
    // domains destroyed every logged hour under that plan on every
    // saveWeekPlan call. Symptom users hit: add an unplanned task,
    // click Save, all previously-logged hours reset to zero.
    //
    // Fix: for each child table (domains, tasks, goals), upsert on
    // primary id and delete only rows that are no longer in the
    // incoming plan. Existing rows with unchanged IDs are UPDATED in
    // place — no cascade, no data loss.
    const incomingDomainIds = new Set(plan.domains.map((d) => d.id));
    const incomingTaskIds = new Set(
      plan.domains.flatMap((d) => d.tasks.map((t) => t.id)),
    );
    const incomingGoalIds = new Set((plan.goals ?? []).map((g) => g.id));

    if (plan.domains.length > 0) {
      const domainRows = plan.domains.map((d, index) => ({
        id: d.id,
        user_id: userId,
        week_plan_id: plan.id,
        name: d.name,
        color_key: d.colorKey,
        principle_id: d.principleId,
        position: index,
      }));
      const { error } = await this.supabase
        .from('week_domains')
        .upsert(domainRows, { onConflict: 'id' });
      if (error) throw error;

      const taskRows = plan.domains.flatMap((d) =>
        d.tasks.map((t, index) => ({
          id: t.id,
          user_id: userId,
          week_plan_id: plan.id,
          week_domain_id: d.id,
          title: t.title,
          planned_hours: t.plannedHours,
          position: index,
          tags: t.tags ?? null,
          completed_at: t.completedAt ?? null,
        })),
      );
      if (taskRows.length > 0) {
        const { error: tasksErr } = await this.supabase
          .from('week_tasks')
          .upsert(taskRows, { onConflict: 'id' });
        if (tasksErr) throw tasksErr;
      }
    }

    // Delete children that used to exist for this plan but aren't in
    // the incoming version. `.not('id', 'in', ...)` needs a comma-
    // separated `(v1,v2)` list; empty set → delete all.
    const listOrNever = (ids: Set<string>) =>
      ids.size > 0 ? `(${[...ids].join(',')})` : '(00000000-0000-0000-0000-000000000000)';

    // Delete tasks first (child of domain, and referenced by
    // hours_logged.task_id — narrowing the surface for cascade harm).
    const { error: delTasksErr } = await this.supabase
      .from('week_tasks')
      .delete()
      .eq('week_plan_id', plan.id)
      .not('id', 'in', listOrNever(incomingTaskIds));
    if (delTasksErr) throw delTasksErr;

    const { error: delDomainsErr } = await this.supabase
      .from('week_domains')
      .delete()
      .eq('week_plan_id', plan.id)
      .not('id', 'in', listOrNever(incomingDomainIds));
    if (delDomainsErr) throw delDomainsErr;

    if (plan.goals && plan.goals.length > 0) {
      const goalRows = plan.goals.map((g, index) => ({
        id: g.id,
        user_id: userId,
        week_plan_id: plan.id,
        text: g.text,
        completed_at: g.completedAt ?? null,
        position: index,
      }));
      const { error } = await this.supabase
        .from('week_goals')
        .upsert(goalRows, { onConflict: 'id' });
      if (error) throw error;
    }
    const { error: delGoalsErr } = await this.supabase
      .from('week_goals')
      .delete()
      .eq('week_plan_id', plan.id)
      .not('id', 'in', listOrNever(incomingGoalIds));
    if (delGoalsErr) throw delGoalsErr;
  }

  async deleteWeekPlan(weekId: string): Promise<void> {
    // FK cascade removes week_domains → week_tasks and week_goals.
    const userId = await currentUserId(this.supabase);
    const { error } = await this.supabase
      .from('week_plans')
      .delete()
      .eq('id', weekId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  // ─── WeekLog ───────────────────────────────────────────────────────────
  //
  // Local shape: WeekLogEntry with taskHours: Record<taskId, hours> —
  //   one entry per (weekId, dateISO).
  // Cloud shape: hours_logged with one row per (user, task, date) —
  //   normalized for M3 aggregation queries.
  //
  // On read: group cloud rows by dateISO, rebuild the Record. Synthesize
  //   a deterministic entry id as `${weekId}-${dateISO}` so callers
  //   have a stable handle.
  // On write: wipe rows for (user, weekId, dateISO), insert fresh
  //   per-task rows.

  async getWeekLogs(weekId: string): Promise<WeekLogEntry[]> {
    const userId = await currentUserId(this.supabase);
    const { data, error } = await this.supabase
      .from('hours_logged')
      .select('*')
      .eq('user_id', userId)
      .eq('week_plan_id', weekId);
    if (error) throw error;

    type Bucket = {
      taskHours: Record<string, number>;
      createdAt: string;
      updatedAt: string;
    };
    const byDate = new Map<string, Bucket>();
    for (const row of data ?? []) {
      const dateIso = row.date_iso as string;
      const bucket =
        byDate.get(dateIso) ??
        ({
          taskHours: {},
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        } as Bucket);
      // Unplanned rows (task_id null) currently have no natural key in
      // the local WeekLogEntry shape — skip them in read for M2.3 and
      // revisit when the log UI handles unplanned tasks against cloud.
      if (row.task_id) {
        bucket.taskHours[row.task_id as string] = numOr(row.hours, 0);
      }
      if ((row.updated_at as string) > bucket.updatedAt) {
        bucket.updatedAt = row.updated_at as string;
      }
      if ((row.created_at as string) < bucket.createdAt) {
        bucket.createdAt = row.created_at as string;
      }
      byDate.set(dateIso, bucket);
    }

    return Array.from(byDate.entries()).map(([dateISO, bucket]) => ({
      id: `${weekId}-${dateISO}`,
      weekId,
      dateISO,
      taskHours: bucket.taskHours,
      createdAt: bucket.createdAt,
      updatedAt: bucket.updatedAt,
    }));
  }

  async saveWeekLog(entry: WeekLogEntry): Promise<void> {
    const userId = await currentUserId(this.supabase);

    // ADDITIVE semantics: for each (task, hours) in the incoming
    // entry, ADD the hours to any existing row for
    // (user_id, task_id, date_iso). If no row exists, insert a new
    // one. Rows for tasks NOT in the incoming entry are untouched.
    //
    // Why additive:
    //   - The LogPanel input placeholder is "+0" and the running
    //     total shows next to it as "{completed}h logged". Users
    //     type how much to ADD, not the new total.
    //   - LocalRepository.saveWeekLog appends a new weekLogs row per
    //     save and `sumTaskHours` aggregates across rows on read —
    //     so local is already additive by construction. Cloud must
    //     match or signed-in users see different behavior than
    //     signed-out.
    //
    // Prior bugs the additive model fixes:
    //   - Wipe-and-reinsert (original): destroyed OTHER tasks' logs
    //     on any partial save.
    //   - Replace-per-task (first fix): fixed the wipe but made
    //     re-saving the same task on the same date replace instead
    //     of accumulate. User logs 8h sleep, later logs 4h more,
    //     expects 12h but sees 4h.
    //
    // We can't use PostgREST's .upsert({ onConflict: ... }) with an
    // increment expression — Supabase JS doesn't accept SQL
    // expressions in upsert values. Read-then-write is fine for the
    // small row counts a single save produces.
    const filtered = Object.entries(entry.taskHours).filter(
      ([, hours]) => Number(hours) > 0,
    );
    if (filtered.length === 0) return;

    const taskIds = filtered.map(([taskId]) => taskId);

    // Fetch prior hours for these tasks on this date.
    const { data: existing, error: readErr } = await this.supabase
      .from('hours_logged')
      .select('id, task_id, hours')
      .eq('user_id', userId)
      .eq('date_iso', entry.dateISO)
      .in('task_id', taskIds);
    if (readErr) throw readErr;

    const priorByTask = new Map<string, { id: string; hours: number }>();
    for (const row of existing ?? []) {
      const tid = row.task_id as string | null;
      if (!tid) continue;
      priorByTask.set(tid, {
        id: row.id as string,
        hours: Number(row.hours),
      });
    }

    // Split into UPDATEs (task already has a row today) and INSERTs
    // (first log for this task today). Both use Promise.all so a
    // batch save of N tasks costs 1 read + max(N updates, 1 insert
    // batch) round-trips.
    const updates: Array<() => Promise<void>> = [];
    const inserts: Array<Record<string, unknown>> = [];
    for (const [taskId, hoursStr] of filtered) {
      const hours = Number(hoursStr);
      const prior = priorByTask.get(taskId);
      if (prior) {
        updates.push(async () => {
          const { error } = await this.supabase
            .from('hours_logged')
            .update({ hours: prior.hours + hours })
            .eq('id', prior.id);
          if (error) throw error;
        });
      } else {
        inserts.push({
          id: crypto.randomUUID(),
          user_id: userId,
          task_id: taskId,
          week_plan_id: entry.weekId,
          date_iso: entry.dateISO,
          hours,
        });
      }
    }
    await Promise.all(updates.map((run) => run()));
    if (inserts.length > 0) {
      const { error: insErr } = await this.supabase
        .from('hours_logged')
        .insert(inserts);
      if (insErr) throw insErr;
    }

    // Bump profiles.last_activity_at so the home-page greeting
    // ("It's been N days") reflects that the user just logged. Local
    // repo does this in bumpProfileActivity — cloud didn't, so
    // signed-in users saw a stale greeting no matter how often they
    // logged. Awaited: PostgrestBuilder only fires on .then(), so
    // `void builder` would silently drop the request.
    const { error: bumpErr } = await this.supabase
      .from('profiles')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (bumpErr) throw bumpErr;
  }

  // ─── WeekNote ──────────────────────────────────────────────────────────

  async getWeekNote(weekId: string): Promise<WeekNote | null> {
    const userId = await currentUserId(this.supabase);
    const { data, error } = await this.supabase
      .from('week_notes')
      .select('*')
      .eq('user_id', userId)
      .eq('week_plan_id', weekId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      weekId: data.week_plan_id,
      note: data.note,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async listWeekNotes(weekId: string): Promise<WeekNote[]> {
    const userId = await currentUserId(this.supabase);
    const { data, error } = await this.supabase
      .from('week_notes')
      .select('*')
      .eq('user_id', userId)
      .eq('week_plan_id', weekId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      weekId: row.week_plan_id,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async saveWeekNote(note: WeekNote): Promise<void> {
    const userId = await currentUserId(this.supabase);
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('week_notes').upsert(
      {
        id: note.id,
        user_id: userId,
        week_plan_id: note.weekId,
        note: note.note,
        created_at: note.createdAt || now,
        updated_at: now,
      },
      { onConflict: 'id' },
    );
    if (error) throw error;
  }
}
