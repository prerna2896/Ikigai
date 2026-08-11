# Ikigai — cloud migration task tracker

Living checklist. Mirror of [PLAN.md](./PLAN.md) at task granularity. Update as work progresses; strike done items in-place instead of deleting so history is readable.

## M1 — Security & RLS verification ✅

- [x] Worktree `wt/cloud-migration-m1` off `main` at `Ikigai-cloud-migration-m1/`.
- [x] `packages/db/` with Drizzle schema for 12 user-scoped tables (+ `USER_SCOPED_TABLES` manifest).
- [x] `supabase/migrations/0000_init_schema.sql` (auto-generated, stripped `auth.users` create).
- [x] `supabase/migrations/0001_enable_rls.sql` (RLS + FORCE RLS + 48 policies + self-check).
- [x] `supabase/scripts/audit-rls.{sql,sh}` — static coverage audit (drift-detection included).
- [x] `supabase/tests/rls_isolation.sql` — 51-assertion pgTAP suite.
- [x] `supabase/scripts/run-pgtap.sh` — creates throwaway auth users, invokes psql, cleans up.
- [x] `tests/rls/isolation.spec.ts` — 9 Playwright end-to-end RLS tests.
- [x] `playwright.rls.config.ts` — separate config (no dev server).
- [x] Local Supabase via colima + `supabase start` — all three gates green.
- [x] User-verified: schema visible in Studio, no cross-user data leakage.

## M2 — Multi-device sync

### M2.1 — Auth wired in (in progress)

- [x] `lib/supabase/{server,client,middleware}.ts` — three Supabase clients (RSC/route-handler, browser, middleware refresh).
- [x] `middleware.ts` at repo root — session cookie refresh on every request.
- [x] `/login` page — email input + `signInWithOtp`, Resend link, error surfacing.
- [x] `/auth/confirm` route — `verifyOtp({ token_hash, type })` for cross-browser magic-link.
- [x] `/auth/logout` route — POST-only sign-out + redirect home.
- [x] TopNav shows Sign in link / Sign out button. Email not visible (hover title only).
- [x] `.env.local.example`, `.env.local`, expanded `.gitignore`.
- [x] `supabase/templates/{magic_link,confirmation}.html` — minimal templates using `TokenHash` AND `{{ .Token }}` (6-digit code for cross-device entry).
- [x] `supabase/config.toml` wired to those templates; `additional_redirect_urls` widened for both dev ports.
- [x] `[auth.sessions] inactivity_timeout = "1440h"` — 60-day inactivity timeout (per user request).
- [x] **Full auth gate**: middleware redirects signed-out users away from every route except `/`, `/login`, `/auth/*`. Landing page (`/`) is still public but shows only NoOnboarding for signed-out users regardless of Dexie state. Data visibility requires a session — per user decision.
- [x] `/login` supports two flows: magic link (default) AND 6-digit code entry (for cross-device: iPad while phone holds the email).
- [ ] User-verified: sign up → magic link in Mailpit → click in any browser → land signed in.
- [ ] User-verified: 6-digit code flow works cross-device.

### Known transitional issue

- Existing Dexie data in already-used browsers becomes **unreachable** now that data visibility requires a session. Options:
  1. Wait for M4 (migration lifts existing Dexie into cloud on first sign-in). Data appears in cloud after M2.2+M4 land.
  2. Clear browser Dexie manually now to start fresh.
- No data loss in either case — Dexie contents persist untouched, just gated behind sign-in.

### M2.2 — CloudRepository for Profile + Settings

- [x] `packages/cloud-storage/` package with `@ikigai/cloud-storage` workspace alias.
- [x] `CloudRepository` implementing `ProfileRepository` + `SettingsRepository`. Uses supabase-js browser client — every call carries the user's JWT, RLS enforces isolation. Reflections/goals stored in their own tables and stitched back into the `Profile` shape on read.
- [x] `components/RepositoryProvider.tsx` — Context + `useRepository()` hook. Signed-in users get `CloudRepository`; signed-out users get the existing `LocalRepository`. Handles the pre-resolution loading state.
- [x] `app/layout.tsx` wraps `RepositoryProvider` inside `ThemeProvider`.
- [x] All Profile+Settings call sites migrated: TopNav, BottomNav, `app/page.tsx`, `/profile`, `/settings`, `CapacityCard`, and all onboarding steps (`context`, `tone`, `reflection`, `goals`, `settings`).
- [x] All WeekPlan / WeekLog / WeekNote / WeekGoal sites left on `LocalRepository` — that's M2.3.
- [x] `resetOnboarding` still calls Local (no cloud equivalent yet; noted as M4 concern).
- [ ] User-verified: sign up → onboarding → row appears in Supabase Studio. Sign in on second browser as the same email → landing shows their data instead of the Begin prompt (well, Profile+Settings do; planner data still Dexie until M2.3).

### Sign-in-before-Begin — now moot

The earlier TASK about "add sign-in step to onboarding" was resolved differently in M2.1: full auth-gate via middleware means signing in happens before any protected page, including onboarding. So there's no separate "sign-in step" to add — it's the middleware.

### M2.3 — CloudRepository for planner surface

- [x] `CloudRepository` extended with `WeekPlanRepository` (fan-out reads across week_plans + week_domains + week_tasks + week_goals; wipe-and-insert writes) + `WeekLogRepository` (Local `taskHours: Record<taskId, hours>` ↔ normalized `hours_logged` rows) + `WeekNoteRepository` (single-table CRUD).
- [x] `RepositoryProvider` exposes `weekPlanRepo`, `weekLogRepo`, `weekNoteRepo` alongside the existing profile+settings. Cloud when signed in, Local when not.
- [x] Call sites migrated: `app/page.tsx`, `app/week/plan/page.tsx`, `app/week/[weekId]/page.tsx`, `app/week/plan/domain/[domainId]/page.tsx`, `app/log/page.tsx`, `app/reflect/page.tsx`, `app/history/page.tsx`, `components/LogPanel.tsx`, `components/WeekGoals.tsx`.
- [x] `/profile` reset extended to wipe `week_plans` + `week_notes` cloud rows (FK cascade drops week_domains, week_tasks, week_goals, hours_logged).
- [x] Route protection: already-in-place middleware auth-gates everything except `/`, `/login`, `/auth/*`. No additional wiring needed.
- [ ] Dexie retained as offline read cache (populated on cloud read). **Deferred to M2.4** — the sync engine milestone. Currently reads/writes go to whichever repo is active; no cache-through.
- [ ] User-verified: sign in → plan a week on Browser A → sign in same email on Browser B → see the same plan; log time on B → refresh A → hours show up.

### Known limitations of M2.3

- **No transactions**: `saveWeekPlan` upserts the parent then wipes and re-inserts child rows in sequential requests. If the client dies mid-save, the plan can be left with partial children. M2.4 formalizes atomicity via pending-mutation replay.
- **saveWeekPlan is heavy**: ~50 row writes per save call because we wipe + re-insert all week_domains and week_tasks. Fine at current cadence (once per blur, not per keystroke). Revisit if perf shows up in traces.
- **`listWeekPlans` fan-out**: for a user with N plans, it does N+1 queries (1 parent list, N child fetches). Batchable with `json_agg` if needed, deferred.
- **Reflections/goals wipe on saveProfile**: same pattern as M2.2. Fine at onboarding cadence.

### M2.4 — Sync engine

Shipped as a **phase 1**: minimal Realtime layer that gives cross-device live sync without the full TanStack Query rewrite. Optimistic updates, offline queue, and version-based conflict resolution are deferred to M2.4b (a follow-up mini-milestone).

- [x] Migration `0002_realtime_publication.sql` adds all 11 user-scoped tables to `supabase_realtime` publication and sets `REPLICA IDENTITY FULL` (so UPDATE/DELETE events carry the whole old row for client-side diffing).
- [x] `components/CloudSyncProvider.tsx` subscribes to `postgres_changes` (`event: '*'`) for every user-scoped table, filtered to the current user's `user_id`. Any change bumps a `version` counter exposed via context.
- [x] Consumer wiring: TopNav, BottomNav, home, planner, log, reflect, history, profile, week/[weekId] all list `cloudVersion` in their data-loading useEffect deps → they refetch on remote change.
- [x] RLS applies to Realtime — Playwright test proves another user's row changes never reach this user's session.
- [x] Playwright suite in `tests/cloud/realtime.spec.ts`:
  - `profile update via admin propagates to open page without refresh` — passes.
  - `changes to another user's rows do NOT trigger this user's refresh (RLS on Realtime)` — passes.

**Deferred to M2.4b** (not needed for the "phone updates laptop live" experience, but real requirements for a production sync engine):
- [ ] TanStack Query cache + typed query keys (currently every consumer runs its own useEffect refetch — works but coarse).
- [ ] Optimistic UI updates (currently each save round-trips before the UI reflects).
- [ ] Dexie `pending_mutations` offline queue with reconnect drain.
- [ ] LWW conflict rule + version-skew rejection (only matters once we introduce finer-grained mutations — current wipe-and-insert avoids the class of conflicts entirely).

### M2.5 — Sync verification

- [ ] Two-context Playwright: Realtime propagation p95 < 2s.
- [ ] Refetch fallback (Realtime disabled).
- [ ] Offline write → drain → assert per-write success.
- [ ] Kill-mid-write recovery.
- [ ] Concurrent edit → LWW converges.
- [ ] Version-skew rejection with client refetch.
- [ ] 50-queued-write load characterization.

## Follow-up mini-milestones (not gating M2)

- [ ] Google OAuth — requires user's Google Cloud Console setup. Spec TBD.
- [ ] Apple OAuth — requires Apple Developer Program. Spec TBD.
- [ ] Passkey / WebAuthn.
- [ ] Branded email template — see [specs/email-template.md](./specs/email-template.md).
- [ ] Ikigai `docs/README.md`, `docs/PLAN.md`, `docs/TASKS.md` created (this file). Per workspace `CLAUDE.md` convention. Done as part of M2.1.

## M3 — Analytical query performance (not started)

## M4 — Local-to-cloud migration ✅

Shipped. Existing IndexedDB data lifts into Supabase on the first authenticated session in that browser, idempotent, cloud-wins on conflict.

- [x] Dexie schema bumped to v11 with a `meta` k/v store; `getMeta`/`setMeta` exposed on `LocalRepository`. Marker key: `cloudMigratedAt:<userId>`.
- [x] `packages/cloud-storage/src/migrator.ts` — `LocalToCloudMigrator`:
  - Reads profile / settings / week plans (with children) / logs / notes from Dexie.
  - For each entity, checks cloud first — **cloud wins**. If cloud has a profile/settings/plan for the same week, skip the local version entirely (no partial merges).
  - Writes with explicit `INSERT` (not upsert), and the marker gate makes second runs a no-op regardless.
  - Sets the marker on success.
- [x] `components/CloudMigrationRunner.tsx` mounted in layout, subscribes to auth state, runs migration once per (userId, browser). Small toast during run, sr-only marker when done for test hooks.
- [x] Playwright test [`tests/cloud/local-to-cloud-migration.spec.ts`](../tests/cloud/local-to-cloud-migration.spec.ts):
  - Seeds Dexie with a realistic pre-cloud profile + settings + week plan (with domain + task + goals) + week log + week note.
  - Signs in via UI (code flow via Mailpit).
  - Asserts all rows appear in cloud with correct shape and single count.
  - Reloads → asserts no duplication (idempotent).

### Deferred / follow-ups (not blocking anything)

- Partial-failure recovery test — currently if migration throws mid-way, the marker isn't set and next run tries again. Fine but no explicit resume-with-partial-state test.
- Cross-device collision test (Browser 1 has Dexie plans for week X; Browser 2 already migrated for same user; Browser 1 signs in) — currently protected by the cloud-wins rule (plans skipped), but no explicit test.
- Malformed-data test — `LocalRepository.listWeekPlans` already repairs stale rows via Zod. We rely on that; no additional test.
