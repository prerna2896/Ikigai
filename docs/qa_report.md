# QA Report — Ikigai

## Summary
- Manual review performed by reading the UI components and routing logic.
- Playwright suite could not execute because the dev server failed to bind to port 3000 (`EPERM`). No test artifacts produced.
- Navigation invariants and main flows appear consistent in code, but a few potential issues were identified.

## Environment assumptions
- Run from repo root (`/Users/prernaagarwal/wonder/Ikigai`)
- Start tests with: `pnpm test:e2e`
- Server: `pnpm dev` on `http://localhost:3000`

## Bugs

| ID | Title | Severity | Repro steps | Expected vs actual | Suspected cause | Screenshot/trace | Suggested fix direction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-001 | E2E tests fail to start due to port bind error | P1 | Run `pnpm test:e2e` | Expected: dev server starts and tests run. Actual: server fails with `listen EPERM 0.0.0.0:3000`. | Environment/process already binding port 3000 or sandbox restriction. | None (test run failed before any tests). | Allow configurable port in Playwright config or ensure no process occupies port 3000; retry after freeing port. |
| QA-002 | Onboarding settings step resets on refresh | P2 | Navigate to `/onboarding/settings`, advance to step 2 or 3, then refresh | Expected: same step remains (or URL encodes step). Actual: state resets to step 1 because step isn’t synced to URL. | `app/onboarding/settings/page.tsx` only reads step from `?step` once; state changes don’t update query params. | N/A | Update the step navigation to push `?step=` on Next/Back so refresh preserves step. |

## Gaps / missing specs
- Behavior when “Go to planning” is used without any onboarding data is not explicitly specified. Current behavior redirects to onboarding if no profile exists (based on code), which might be acceptable but should be confirmed.

## Test status
- `pnpm test:e2e` failed to start the dev server: `listen EPERM: operation not permitted 0.0.0.0:3000`.
- No traces/screenshots were generated because the server did not launch.

## Notes
- E2E fixtures and reset mechanism are in place, but the server must start before tests can run.
