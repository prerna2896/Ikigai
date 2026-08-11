import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalRepository } from '@ikigai/storage';
import type { WeekDomain, WeekGoal, DomainTask, WeekPlan } from '@ikigai/core';

// M4 — Local (Dexie) → Cloud (Supabase) migration.
//
// One-shot per user, per browser. Runs the first time a user signs in
// on a browser that has legacy Dexie data. Marks itself as done in the
// Dexie `meta` store so it never re-runs.
//
// Conflict rule: **cloud wins**. If any cloud row exists for a given
// entity (profile, settings, or a specific week_plan), we skip the
// entire local version for that entity. Rationale: cloud data was
// created intentionally by a signed-in user; Dexie data may be
// pre-cloud or from a different account that used this browser.
// Merging is fraught (whose reflection wins? which week_task is
// canonical?) — cloud-wins gives us a boring, predictable outcome.
//
// The exception is settings, which is a singleton — if cloud has any
// settings row for this user, we assume it's canonical and skip.
//
// Idempotency: the marker check makes a second run a no-op. Even
// without the marker, every insert uses `ON CONFLICT DO NOTHING` /
// `.onConflict(... ignoreDuplicates: true)` so repeated runs never
// duplicate.

export type MigrationResult = {
  ranAt: string;
  migratedProfile: boolean;
  migratedSettings: boolean;
  migratedWeekPlans: number;
  migratedWeekLogs: number;
  migratedWeekNotes: number;
  skippedReason?:
    | 'already-migrated'
    | 'no-local-data'
    | 'other-user-owns-local';
};

const MARKER_PREFIX = 'cloudMigratedAt:';
const markerKey = (userId: string) => `${MARKER_PREFIX}${userId}`;

export class LocalToCloudMigrator {
  constructor(
    private readonly local: LocalRepository,
    private readonly cloud: SupabaseClient,
    private readonly userId: string,
  ) {}

  async isAlreadyMigrated(): Promise<boolean> {
    const value = await this.local.getMeta(markerKey(this.userId));
    return value !== null;
  }

  async markMigrated(): Promise<void> {
    await this.local.setMeta(
      markerKey(this.userId),
      new Date().toISOString(),
    );
  }

  // Shared-phone guard: if Dexie already has a `cloudMigratedAt:*`
  // marker for a DIFFERENT user, this local data belongs to whoever
  // owned this browser first. Treat it as "someone else's data" and
  // skip migration — otherwise we'd silently copy their profile,
  // settings, and weeks into the newly signed-in user's cloud.
  //
  // The intended flow (one person, first sign-in on their phone) has
  // NO marker yet, so this check is a no-op there.
  async hasForeignMarker(): Promise<boolean> {
    const keys = await this.local.listMetaKeys(MARKER_PREFIX);
    const myKey = markerKey(this.userId);
    return keys.some((k) => k !== myKey);
  }

  async run(): Promise<MigrationResult> {
    const ranAt = new Date().toISOString();

    if (await this.isAlreadyMigrated()) {
      return {
        ranAt,
        migratedProfile: false,
        migratedSettings: false,
        migratedWeekPlans: 0,
        migratedWeekLogs: 0,
        migratedWeekNotes: 0,
        skippedReason: 'already-migrated',
      };
    }

    if (await this.hasForeignMarker()) {
      // Do NOT set our own marker here — this user hasn't actually
      // migrated anything. If they later sign in on a browser that
      // IS theirs, migration should run normally.
      // eslint-disable-next-line no-console
      console.debug(
        '[m4] foreign marker present — local data belongs to a previous user, skipping',
      );
      return {
        ranAt,
        migratedProfile: false,
        migratedSettings: false,
        migratedWeekPlans: 0,
        migratedWeekLogs: 0,
        migratedWeekNotes: 0,
        skippedReason: 'other-user-owns-local',
      };
    }

    // Read everything from Dexie up-front so a mid-run failure has a
    // consistent view.
    const localProfile = await this.local.getProfile();
    const localSettings = await this.local
      .getSettings()
      .catch(() => null);
    let localWeekPlans: WeekPlan[] = [];
    try {
      localWeekPlans = await this.local.listWeekPlans();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[m4] listWeekPlans failed', err);
    }
    // eslint-disable-next-line no-console
    console.debug('[m4] local counts', {
      profile: Boolean(localProfile),
      settings: Boolean(localSettings),
      weekPlans: localWeekPlans.length,
    });

    // If Dexie is genuinely empty, mark and short-circuit.
    if (
      !localProfile &&
      !localSettings &&
      localWeekPlans.length === 0
    ) {
      await this.markMigrated();
      return {
        ranAt,
        migratedProfile: false,
        migratedSettings: false,
        migratedWeekPlans: 0,
        migratedWeekLogs: 0,
        migratedWeekNotes: 0,
        skippedReason: 'no-local-data',
      };
    }

    // ─── Profile ────────────────────────────────────────────────────────
    let migratedProfile = false;
    if (localProfile) {
      const { data: cloudProfile } = await this.cloud
        .from('profiles')
        .select('user_id')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (!cloudProfile) {
        // upsert with ignoreDuplicates: true — if a race or stale
        // SELECT led us here despite a row existing, the write is a
        // no-op instead of a 409. Cloud-wins guarantee preserved.
        const now = new Date().toISOString();
        const { error } = await this.cloud
          .from('profiles')
          .upsert(
            {
              user_id: this.userId,
              name: localProfile.name,
              life_areas: localProfile.lifeAreas ?? null,
              last_activity_at: localProfile.lastActivityAt ?? null,
              created_at: localProfile.createdAt || now,
              updated_at: now,
            },
            { onConflict: 'user_id', ignoreDuplicates: true },
          );
        if (error) throw error;

        if (localProfile.reflections.length > 0) {
          await this.cloud.from('profile_reflections').upsert(
            localProfile.reflections.map((r) => ({
              id: crypto.randomUUID(),
              user_id: this.userId,
              question_id: r.questionId,
              answer: r.answer,
            })),
            { onConflict: 'user_id,question_id', ignoreDuplicates: true },
          );
        }
        if (localProfile.goals && localProfile.goals.length > 0) {
          await this.cloud.from('profile_goals').upsert(
            localProfile.goals.map((g) => ({
              id: crypto.randomUUID(),
              user_id: this.userId,
              text: g.text,
              timeline: g.timeline,
              created_at: g.createdAt,
            })),
            { onConflict: 'id', ignoreDuplicates: true },
          );
        }
        migratedProfile = true;
      }
    }

    // ─── Settings ───────────────────────────────────────────────────────
    let migratedSettings = false;
    if (localSettings) {
      const { data: cloudSettings } = await this.cloud
        .from('settings')
        .select('user_id')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (!cloudSettings) {
        const now = new Date().toISOString();
        const { error } = await this.cloud.from('settings').upsert(
          {
            user_id: this.userId,
            sleep_hours_per_day: localSettings.sleepHoursPerDay,
            maintenance_hours_per_day: localSettings.maintenanceHoursPerDay,
            weekly_capacity_hours: localSettings.weeklyCapacityHours,
            weekly_capacity_hours_derived:
              localSettings.weeklyCapacityHoursDerived,
            buffer_percent: localSettings.bufferPercent,
            week_start_day: localSettings.weekStartDay,
            week_time_zone: localSettings.weekTimeZone,
            preferred_tone: localSettings.preferredTone,
            profession_type: localSettings.professionType,
            profession_other_text: localSettings.professionOtherText,
            has_job: localSettings.hasJob,
            job_hours_per_week: localSettings.jobHoursPerWeek,
            is_student: localSettings.isStudent,
            class_hours_per_week: localSettings.classHoursPerWeek,
            strictness: localSettings.strictness,
            check_in_frequency: localSettings.checkInFrequency ?? null,
            planning_frequency: localSettings.planningFrequency ?? null,
            created_at: localSettings.createdAt || now,
            updated_at: now,
          },
          { onConflict: 'user_id', ignoreDuplicates: true },
        );
        if (error) throw error;
        migratedSettings = true;
      }
    }

    // ─── WeekPlans (+ children + logs + notes) ──────────────────────────
    // For each Dexie plan, skip the whole tree if cloud has a plan for
    // the same week_start_iso.
    let migratedWeekPlans = 0;
    let migratedWeekLogs = 0;
    let migratedWeekNotes = 0;

    if (localWeekPlans.length > 0) {
      const { data: cloudPlans } = await this.cloud
        .from('week_plans')
        .select('id, week_start_iso')
        .eq('user_id', this.userId);
      const cloudPlanWeeks = new Set(
        (cloudPlans ?? []).map((p) => p.week_start_iso as string),
      );

      for (const plan of localWeekPlans) {
        if (cloudPlanWeeks.has(plan.weekStartISO)) {
          // Cloud already owns this week — skip the whole tree.
          continue;
        }
        // Race window: the plan page's auto-create-plan effect can
        // fire between our upfront SELECT and this INSERT, landing a
        // plan for the same week under our nose. Treat a 23505
        // (duplicate key on PK or unique index) the same as the
        // cloud-wins skip above.
        const now = new Date().toISOString();
        const { error: planErr } = await this.cloud
          .from('week_plans')
          .insert({
            id: plan.id,
            user_id: this.userId,
            week_start_iso: plan.weekStartISO,
            week_end_iso: plan.weekEndISO,
            week_start_day: plan.weekStartDay,
            week_time_zone: plan.weekTimeZone,
            is_frozen: plan.isFrozen,
            created_at: plan.createdAtISO || now,
            updated_at: now,
          });
        if (planErr) {
          if ((planErr as { code?: string }).code === '23505') {
            // eslint-disable-next-line no-console
            console.debug(
              '[m4] cloud already has plan for',
              plan.weekStartISO,
              '— skipping subtree',
            );
            continue;
          }
          throw planErr;
        }
        migratedWeekPlans += 1;

        // Remap Dexie's local UUIDs to fresh ones per migration. The
        // child tables (week_domains, week_tasks, week_goals,
        // week_notes) all have global single-column PKs on `id`, so
        // reusing the Dexie ids means user B's migration on a browser
        // that user A already migrated hits a cross-user PK collision.
        // Fresh ids keep the parent→child references consistent
        // within this migration run while sidestepping the collision.
        // week_plans.id can safely stay as the Dexie weekStartISO
        // because its PK is composite (user_id, id) — see
        // migration 0003_week_plans_composite_pk.sql.
        const domainIdMap = new Map<string, string>();
        const taskIdMap = new Map<string, string>();
        for (const d of plan.domains) {
          domainIdMap.set(d.id, crypto.randomUUID());
          for (const t of d.tasks) {
            taskIdMap.set(t.id, crypto.randomUUID());
          }
        }

        if (plan.domains.length > 0) {
          await this.cloud.from('week_domains').insert(
            plan.domains.map((d: WeekDomain, i: number) => ({
              id: domainIdMap.get(d.id)!,
              user_id: this.userId,
              week_plan_id: plan.id,
              name: d.name,
              color_key: d.colorKey,
              principle_id: d.principleId,
              position: i,
            })),
          );
          const allTasks = plan.domains.flatMap((d: WeekDomain) =>
            d.tasks.map((t: DomainTask, i: number) => ({
              id: taskIdMap.get(t.id)!,
              user_id: this.userId,
              week_plan_id: plan.id,
              week_domain_id: domainIdMap.get(d.id)!,
              title: t.title,
              planned_hours: t.plannedHours,
              position: i,
              tags: t.tags ?? null,
            })),
          );
          if (allTasks.length > 0) {
            await this.cloud.from('week_tasks').insert(allTasks);
          }
        }

        if (plan.goals && plan.goals.length > 0) {
          await this.cloud.from('week_goals').insert(
            plan.goals.map((g: WeekGoal, i: number) => ({
              id: crypto.randomUUID(),
              user_id: this.userId,
              week_plan_id: plan.id,
              text: g.text,
              completed_at: g.completedAt ?? null,
              position: i,
            })),
          );
        }

        // Logs for this plan. Remap task_id via taskIdMap so the FK
        // to the just-inserted week_tasks row is preserved. If the
        // log references a task_id we don't know about (orphaned
        // Dexie entry — shouldn't happen but be defensive), drop it
        // rather than break the FK.
        const localLogs = await this.local.getWeekLogs(plan.id);
        for (const log of localLogs) {
          const taskHourEntries = Object.entries(log.taskHours).filter(
            ([taskId, hours]) =>
              Number(hours) > 0 && taskIdMap.has(taskId),
          );
          if (taskHourEntries.length === 0) continue;
          await this.cloud.from('hours_logged').insert(
            taskHourEntries.map(([taskId, hours]) => ({
              id: crypto.randomUUID(),
              user_id: this.userId,
              task_id: taskIdMap.get(taskId)!,
              week_plan_id: plan.id,
              date_iso: log.dateISO,
              hours,
            })),
          );
          migratedWeekLogs += 1;
        }

        // Notes for this plan. Fresh id per note for the same reason
        // as domains/tasks — week_notes.id is a global PK.
        const localNotes = await this.local.listWeekNotes(plan.id);
        if (localNotes.length > 0) {
          await this.cloud.from('week_notes').insert(
            localNotes.map((n) => ({
              id: crypto.randomUUID(),
              user_id: this.userId,
              week_plan_id: plan.id,
              note: n.note,
              created_at: n.createdAt,
              updated_at: n.updatedAt,
            })),
          );
          migratedWeekNotes += localNotes.length;
        }
      }
    }

    await this.markMigrated();

    return {
      ranAt,
      migratedProfile,
      migratedSettings,
      migratedWeekPlans,
      migratedWeekLogs,
      migratedWeekNotes,
    };
  }
}
