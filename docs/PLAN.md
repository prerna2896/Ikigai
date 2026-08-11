# Ikigai — cloud migration plan

Living document. Records the *why* behind the multi-milestone move from a local-first Dexie app to a cloud-backed multi-device app. Task granularity lives in [TASKS.md](./TASKS.md); feature-scoped design decisions live under [specs/](./specs/).

## Current architecture (pre-migration)

- Next.js 14 App Router, all pages `'use client'`.
- IndexedDB via Dexie (`packages/storage/src/db.ts`, schema v10).
- Zod validation on every read/write.
- No backend. Data isolated per browser profile.

## Target architecture (post-M2.4)

- Cloud data: Supabase (Postgres) with row-level security. Everyone's data lives in one project, isolated by RLS policies keyed on `auth.uid() = user_id`.
- Client cache: Dexie retained as offline read cache + `pending_mutations` write queue.
- Sync: TanStack Query for server state, optimistic updates, Supabase Realtime for multi-device push.
- Auth: Supabase Auth (email magic-link now, Google/Apple/Passkey as follow-ups).
- ORM: Drizzle (server-side, small cold start on Vercel).
- Data model: server can read plaintext (Model A from the tradeoff evaluation) — enables server-side analytics and insights without extra machinery. Not end-to-end encrypted.

## Migration milestones

Each milestone is independently mergeable and testable. No milestone unlocks the next until its exit criteria are green.

### M1 — Security & RLS verification ✅
- Drizzle schema for 12 user-scoped tables.
- RLS + FORCE RLS + policies for all four DML ops on every table.
- Static policy audit script (fails CI on drift).
- pgTAP suite (51 assertions, in-database).
- Playwright RLS suite (9 assertions, end-to-end through HTTP).

### M2 — Multi-device sync

Phased so a testable UI moment lands early instead of one giant merge at the end.

**M2.1 — Auth wired in (in progress)**
- `/login`, `/auth/confirm`, `/auth/logout`, session middleware.
- Email magic-link only for now. Google + Apple + Passkey are follow-up mini-steps.
- Cross-browser magic link works (uses `verifyOtp` with `token_hash`, not PKCE code exchange).
- 30-day inactivity timeout.

**M2.2 — CloudRepository for Profile + Settings**
- Smallest safest entities first. Onboarding writes to Supabase when signed in, Dexie when not.
- `RepositoryProvider` chooses cloud-if-signed-in.

**M2.3 — CloudRepository for the planner surface**
- WeekPlan, WeekDomain, WeekTask, HoursLogged, WeekGoal, WeekNote.
- Full app now cloud-first for signed-in users. Dexie kept as offline read cache.

**M2.4 — Sync engine**
- TanStack Query cache.
- Dexie `pending_mutations` offline queue with reconnect drain.
- Supabase Realtime channel per user, `postgres_changes` filtered by `user_id`.
- LWW conflict rule via `updated_at`; version-skew rejection via `version`.

**M2.5 — Sync verification suite**
- Two-context Playwright: propagation via Realtime, refetch fallback.
- Offline write → drain → assert.
- Kill-mid-write recovery.
- Concurrent edit LWW.
- Version-skew rejection.
- 50-queued-write load characterization.

### M3 — Analytical query performance

Seed synthetic corpus (10k users × 52 weeks × 7 domains × 5 tasks × 7 daily logs). Establish latency budgets (p95 < 100ms for per-user analytics, p95 < 5s for global aggregates). Introduce materialized views where needed.

### M4 — Local-to-Cloud migration

Idempotent per-user server endpoint that lifts an existing Dexie payload into Supabase using the same UUIDs. Playwright suite covers fresh user, happy path, idempotency, partial-failure recovery, cross-device collision, malformed data.

## Follow-up mini-milestones (out-of-band, not gating any main milestone)

- **Google OAuth**: requires Google Cloud Console setup. See future `docs/specs/oauth-google.md`.
- **Apple OAuth**: requires Apple Developer Program ($99/yr). Needed before App Store submission if we ship SIWA-adjacent to Google. See future `docs/specs/oauth-apple.md`.
- **Passkey / WebAuthn**: no third-party dependency. Should ship alongside Google.
- **Branded email templates**: see [specs/email-template.md](./specs/email-template.md).
- **Route protection**: real `/week/plan`-and-below auth gate lands with M2.3 (when cloud repo depends on auth). Right now those pages still work anonymously against Dexie.
