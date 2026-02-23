# Ikigai

## Project overview
Ikigai is a calm, local-first web app for planning how time is intended to be spent across life domains and reflecting weekly on what actually happened. This repository implements the foundation: domain and settings storage, validation, and a development DB playground to verify persistence.

## Architecture & package boundaries
- `app/`: Next.js App Router UI (client-only for IndexedDB usage).
- `components/`: shared UI components (empty scaffold for now).
- `packages/core/`: single source of truth for domain types, Zod schemas, and shared constants.
- `packages/storage/`: Dexie schema + repository implementations (no UI dependencies).
- `packages/insights/`: stub interface only (no logic yet).

The UI imports types and repositories from `packages/core` and `packages/storage` only. Dexie is never accessed directly from UI components.

## Data model & schema strategy
- All timestamps are stored as ISO strings.
- Zod schemas in `packages/core/src/schemas.ts` mirror the TypeScript types exactly.
- Validation happens on every write and on reads before data is used.
- `activeDomainIds` is capped at 7 and all numeric fields are non-negative.
- Domain colors are constrained to a small, predefined palette.

## Repository abstraction
`packages/storage/src/localRepository.ts` exposes a `LocalRepository` that implements `DomainRepository` and `SettingsRepository`. The UI interacts with these interfaces only. The repository:
- Validates inputs with Zod before writes.
- Validates and normalizes records on reads.
- Ensures the singleton Settings record exists and creates it with defaults if missing.

## How to extend storage later (sync, AI agent)
- Add new Dexie versions in `packages/storage/src/db.ts` using `this.version(n).stores(...)` with migration hooks.
- Keep schema changes aligned with `packages/core` types + Zod schemas.
- Add a remote repository implementation (e.g. REST, sync service) that fulfills the same interfaces.
- Introduce an orchestrator that swaps repositories or merges local/remote data for agent or sync workflows.

## Getting started
```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/dev/db` to use the DB Playground and verify persistence.
