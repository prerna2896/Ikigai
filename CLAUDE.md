# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install        # install dependencies
pnpm dev            # start dev server at http://localhost:3000
pnpm build          # production build
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint

pnpm test:e2e              # run all Playwright tests (starts dev server automatically)
pnpm test:e2e:ui           # Playwright with UI
pnpm test:e2e:headed       # Playwright with browser visible

# Run a single test file
pnpm test:e2e tests/e2e/golden-path.spec.ts
```

## Architecture

Ikigai is a **local-first** Next.js 14 app (App Router, client-only) for weekly time planning and reflection. All data lives in IndexedDB via Dexie — no backend.

### Package boundaries

```
packages/core/       — domain types (types.ts), Zod schemas (schemas.ts), constants, defaults, derived calculations
packages/storage/    — Dexie DB definition (db.ts), repository interfaces (repository.ts), LocalRepository implementation
packages/insights/   — stub only, no logic yet
app/                 — Next.js App Router pages (all 'use client')
components/          — shared UI (IkigaiWheelPlot, IkigaiPrinciplesPlot, settings form)
```

**Import rule:** UI (`app/`, `components/`) imports only from `@ikigai/core` and `@ikigai/storage`. Dexie is never accessed directly in UI code.

Path aliases in `tsconfig.json`:
- `@ikigai/core` → `packages/core/src`
- `@ikigai/storage` → `packages/storage/src`
- `@ikigai/insights` → `packages/insights/src`

### Data layer

`LocalRepository` in `packages/storage/src/localRepository.ts` implements all repository interfaces (`DomainRepository`, `SettingsRepository`, `ProfileRepository`, `WeekPlanRepository`, `WeekLogRepository`, `WeekNoteRepository`). Obtain it via `getLocalRepository()` (singleton, browser-only).

Every write is validated with Zod before hitting Dexie. Every read is validated and normalized before returning — stale/partial records are repaired in-place on read.

`Settings` is a singleton record with `id: 'singleton'`. It is created with defaults if missing.

The Dexie schema is in `packages/storage/src/db.ts` and is currently at version 10. Add new versions with `this.version(n).stores(...)` + migration hooks; never modify existing version definitions.

### Core domain model

All timestamps are ISO strings with timezone offset. Key types (from `packages/core/src/types.ts`):

- `Domain` — life area with a `colorToken` from the constrained `DOMAIN_COLOR_TOKENS` palette
- `Settings` — singleton; owns `weekStartDay`, `weekTimeZone`, `strictness`, capacity hours
- `WeekPlan` — has `weekStartISO`/`weekEndISO`, up to 7 `WeekDomain` entries each with tasks
- `WeekLogEntry` — `taskHours: Record<taskId, hours>` logged on a specific date
- `WeekDraft` / `DraftTask` / `FrozenWeekSnapshot` / `WeekReview` — draft planning flow types

### Key constraints

- `WeekPlan.domains` is capped at 7 entries
- `activeDomainIds` is capped at 7
- All numeric fields are non-negative
- `Domain.colorToken` must be one of the 7 values in `DOMAIN_COLOR_TOKENS`

### App routes

- `/onboarding/context` → `/name` → `/tone` → `/reflection` → `/goals` → `/settings` — onboarding flow
- `/week/plan` — weekly planning (tasks-first, domain adjustments inline)
- `/profile` — profile view
- `/history` — past week plans

### Testing

E2E tests live in `tests/e2e/`. The Playwright config (`playwright.config.ts`) auto-starts `pnpm dev` and sets `PLAYWRIGHT=1` and `NEXT_PUBLIC_PLAYWRIGHT=1` env vars. Tests use `data-testid` attributes for element selection. Fixtures and helpers are in `tests/e2e/fixtures.ts` and `tests/e2e/helpers.ts`.

## Required checks before declaring a task complete

Before claiming a task is done, Claude MUST run the checks below. If any fail, fix and re-run before responding to the user.

1. **Always (enforced by the project Stop hook):** `pnpm typecheck` and `pnpm lint` must pass. The hook in `.claude/hooks/check-after-stop.sh` blocks the turn from finishing until they do — do not try to skip it.
2. **For UI-touching changes** (anything under `app/`, `components/`, or that changes routing, forms, or rendered output): run the relevant Playwright spec(s). Prefer the most specific spec file rather than the full suite — e.g. `pnpm test:e2e tests/e2e/golden-path.spec.ts` for golden-path changes. Only run `pnpm test:e2e` (full suite) if the change spans many features or you cannot identify the relevant spec.
3. **For data-layer changes** (`packages/storage/`, Dexie schema versions, repository methods): re-run any e2e spec that exercises persistence, plus verify `/dev/db` still loads in dev.

If you cannot run a check (e.g. environment missing a binary, port busy), say so explicitly in the reply rather than claiming success.
