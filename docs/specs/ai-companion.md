# Spec: Kenji companion (AI Insights → ongoing conversation)

Status: **v1 built, pending manual/live verification and the mental-health copy review below.** The rest of this doc is the original design draft; see "Shipped log" near the Phasing section for what was actually built and where it deviates.

## What this is

Evolve the existing one-sentence, silence-by-default Kenji insight (`/insights`, `packages/insights`) into an ongoing conversational surface — same character, same voice, same deterministic-signal foundation, but able to hold a back-and-forth instead of only ever speaking once and going quiet. This is an **extension of Kenji**, not a new character or a separate feature bolted on next to it. Nothing about `/insights`' current one-liner behavior needs to regress — the companion is a deeper mode of the same guide, reachable from the same surface.

Decided with the user before this draft:
1. Extends Kenji (this doc), rather than being a new, separate surface.
2. Full safety scope is in-bounds, starting narrow: for extreme-distress input, the MVP response is a fixed crisis-resource referral (not a diagnosis, not a treatment plan, not an attempt to "handle" the situation itself).

## Non-goals

- **Not a therapist.** No diagnosis, no treatment planning, no clinical claims. Kenji reflects, connects to the person's own stated goals/patterns, and — for the one specific severe case — points to real help. Nothing else in the crisis space.
- **Not a general-purpose chatbot.** Scope stays anchored to the person's own weekly planning data (goals, domains, hours, patterns) — the same grounding rule the current system prompt already enforces ("only reference the signal(s) and goals you were given").
- **Not always-on / push-initiated in v1.** The person opens the conversation; Kenji doesn't message them unprompted. (Proactive nudges are a plausible v2, not v1.)

## Current architecture, as it actually stands today

Worth stating precisely, since Ikigai's root `CLAUDE.md` still describes the app as purely local-first/no-backend, but that's stale — `docs/PLAN.md`/`docs/TASKS.md` (M1–M4, mostly shipped) record the real state:

- **Anonymous-first, not local-only.** `middleware.ts` deliberately lets every route work signed-out against Dexie. Signing in switches `RepositoryProvider` to `CloudRepository` (Supabase/Postgres, RLS-isolated per `user_id`), and a one-time migrator lifts existing local data into the cloud on first sign-in (M4, shipped).
- **The rest of the app already stores plaintext server-side.** Goals, tasks, notes, reflections — all live in Postgres for signed-in users, with the server able to read them (M1's "Model A" decision, not end-to-end encrypted). AI Insights specifically chose a *stricter* bar than the rest of the app (zero DB access from its API route, data-minimized payload) — that was a deliberate privacy floor for a feature that talks to a third-party model, not a reflection of what the rest of the backend does.
- **AI Insights today**: `packages/insights` computes `WeeklyMetricsSummary` client-side (`buildWeeklyMetricsSummary`), gates on deterministic `computeWeeklySignals()` (signals.ts — completion drops/improvements, sustained strong, allocation drops, and the new overachievement/tradeoff pairing), then `POST /api/insights/weekly` — a stateless Node route with **no DB access at all** — calls `generateObject` against a strict Zod schema and returns `{shouldSpeak, insight, tone, insightId}`. Nothing persists server-side about the call itself.
- **Kenji's personality system already exists**: `traits.ts` (derives a `PersonalityRead` from onboarding reflection answers), `coachingStyles.ts` (tone rules per style: validation_forward / balanced / direct_data_forward), `personas.ts`. The prompt (`prompt.ts`) already has explicit phrasing rules (one sentence, no template phrases, goal-connection when genuine, and — as of this session — rules for acknowledging a person's own volunteered context and for a specific win+tradeoff pairing).
- **Reactions exist today** on the real `/insights` page (heart/👍/👎 → `insight_reactions` Supabase table, write-only, service-role) and, as of this session, on the dev playground (→ a local JSONL file, explicitly kept separate from the real user table).

## The core architectural tension

A one-shot, stateless, zero-DB call is fundamentally incompatible with "ongoing conversation" — a conversation has to remember what was already said. This is the one real fork in the road:

**Decision: conversation transcripts are a normal signed-in feature, stored in Postgres like everything else the app already stores.** Concretely:
- New `companion_messages` table (Supabase/Drizzle, RLS-isolated by `user_id`, matching the pattern every other user-scoped table already follows — see `packages/db` schema + `supabase/migrations/0001_enable_rls.sql`'s policy pattern).
- Signed-out (anonymous/Dexie) users get the existing one-shot `/insights` experience only, not the multi-turn companion — continuity across turns needs an account the same way continuity across devices already does for the rest of the app. This is a real, deliberate scope line, and it means "extends Kenji" is true for signed-in users and stays exactly as-is for everyone else.
- This keeps the *existing* `/api/insights/weekly` route's zero-DB invariant **fully intact and unchanged** — the companion is a new, additional route (`/api/companion/message` or similar) with its own, different, explicitly-not-zero-DB contract. Don't retrofit statefulness into the one-shot route; two routes with two honestly-different contracts beats one route pretending to be both.

Given the app is already mid-way through a real cloud migration with Postgres/RLS/Realtime in place, this is the boring, consistent choice — not a new architecture, just the existing one applied to a new table.

## What the brief proposed vs. what to actually build first

The pasted brief's storage/tooling list (Redis, Pinecone/pgvector, tiered archival, Llama Guard/NeMo Guardrails) is aimed at a scale and maturity Ikigai isn't at yet. Recommendation: build the smallest version that's honestly useful, on infrastructure already in the stack, and revisit the heavier pieces only once real usage shows they're needed.

| Brief's proposal | v1 recommendation | Why |
|---|---|---|
| Vector DB (Pinecone) for semantic memory | Skip for v1. Recency-windowed transcript (last N turns + this week's `WeeklyMetricsSummary`, same as today) is the context. | No existing usage to prove semantic recall is needed yet; adding a new vendor for a hypothetical is exactly the over-engineering the rest of this codebase's conventions push against. |
| Redis session cache | Skip. Postgres read of the last N messages per conversation is fast enough at this scale; add a cache only if latency data says otherwise. | Same reasoning — no new infra without a measured need. |
| Semantic memory later | If/when needed: `pgvector` on Supabase (already the DB in the stack), not a new vendor. | Reuses existing infra; this is the natural v2, not v1. |
| Full ML moderation classifiers (Llama Guard / NeMo) | v2 hardening. v1 ships a **deterministic** severe-distress keyword/pattern check (see Safety below). | Matches this feature area's existing philosophy exactly: `packages/insights/src/signals.ts` already made the deliberate choice to move "should this fire" out of the LLM and into deterministic code, specifically because LLM judgment on this produced false positives. The same argument applies even more strongly to a safety gate — a classifier's false negative here is a much worse failure mode than a false positive, and a hand-audited deterministic list is more predictable than an ML classifier's failure surface as a v1 floor. |
| Real-time low-latency inference | Standard `generateObject`/streaming via Vercel AI SDK, already the toolchain in use (`ai`, `@ai-sdk/openai`). Streamed response, not a single blocking call, for pacing. | No new toolchain needed. |

## Safety (v1 scope, per the user's explicit decision)

This is the one place where getting the scope wrong is actually costly, so it's spelled out precisely rather than left to prompt instructions alone.

1. **Deterministic pre-check, server-side, before any model call.** A maintained pattern/keyword list for severe distress / self-harm / crisis language runs against the user's message on the server (never client-side only — a client check is trivially bypassed and must not be the only gate). This is the same "don't trust the LLM to self-police the highest-stakes decision" principle already applied to signal-gating.
2. **On match: short-circuit.** Skip the normal Kenji/model call entirely. Return a **fixed, pre-written, never-model-generated** response: acknowledges what they said in one warm sentence, then names concrete resources — e.g. 988 Suicide & Crisis Lifeline (call/text 988, US), Crisis Text Line (text HOME to 741741, US), and a link to https://findahelpline.com for anyone outside the US. Fixed text = zero hallucination risk at the moment it matters most.
3. **Disclosure, once, up front.** Before first use of the companion (not buried in Settings only): a short, plain statement that this is an AI, not a person, not a therapist, and what to do if they need real help right now. Kept accessible from Settings afterward too.
4. **No deceptive framing.** Kenji's voice stays warm (matches the existing character), but the companion never claims to "understand how you feel," never implies memory/care beyond what it actually has, never encourages emotional dependency framing ("I'll always be here for you" — no).
5. **v2 hardening (explicitly deferred, not v1-blocking):** ML-based moderation classifier as a second layer alongside the deterministic list; clinician-reviewed audit of the pattern list and fixed response copy before this ever reaches real users in production (the copy above is a starting draft, not final — a mental-health-literate reviewer should sign off on exact wording before ship, not just an engineer).

## Context assembled per turn

Reuses what already exists rather than inventing a parallel context system:

- `buildWeeklyMetricsSummary()` + `computeWeeklySignals()` — unchanged, still the deterministic "what's actually worth mentioning" gate for weekly patterns.
- `derivePersonalityRead()` / `coachingStyles.ts` — unchanged, still drives tone.
- **New**: last N turns of the actual conversation (raw text, Postgres-backed) — this is a genuine expansion of what crosses to the model versus today's data-minimized summary, and that's an intentional, scoped exception: someone typing directly into a chat they opened is choosing to share that text in the moment, which is a different category from passively-collected reflection/goal text (the existing minimization boundary in `packages/insights/src/summary.ts` stays as-is for the one-shot `/insights` path).
- **New**: session-level state — turn count / rough duration, so the companion can wind down gracefully instead of running indefinitely (brief's "conversational fatigue" point is a reasonable, small addition: a soft prompt to wrap up after a long stretch, not a hard cutoff).

## "Human touch"

Mostly a prompt-writing extension of what already exists, not new architecture:
- Active-listening reflection ("it sounds like...") before problem-solving — add as an explicit prompt rule, same style as the existing tone rules in `coachingStyles.ts`.
- Continuity: reference the last conversation naturally, sourced from the new transcript table, filtered through the same "don't fabricate, only reference what you were actually given" grounding rule already in `prompt.ts`.
- Coaching-style—matched pacing/warmth: already exists per-person via `PersonalityRead`; extend `COACHING_STYLE_RULES` with a couple of conversational-mode-specific lines rather than a parallel style system.

## Phasing

**v1 — text conversation, same signals, safety floor**
- `companion_messages` table + RLS migration.
- `/api/companion/message` route (new, stateful — separate from `/api/insights/weekly`).
- Deterministic crisis pre-check + fixed resource response.
- One-time disclosure UI.
- Conversation UI reusing `ModernMonk` as Kenji's face, reachable from `/insights`.
- Signed-in only.

**v2 — hardening and depth**
- ML moderation classifier as a second safety layer.
- Clinician review pass on crisis copy and pattern list.
- `pgvector`-backed semantic recall across older conversations, if usage shows the recency window isn't enough.
- Proactive/session-fatigue handling refinements.

## Shipped log (v1)

- [x] **Schema + migrations**: `companion_messages` (append-only transcript) and `companion_context` (one table, both tiers) in `packages/db/src/schema.ts`; `supabase/migrations/0008_companion_tables.sql` (hand-reconciled against `pnpm db:generate`'s output — the generator's own journal only knew about `0000_init_schema`, so its raw diff re-proposed already-live changes from 0003/0004; only the genuinely-new statements were kept, plus a hand-added `role` CHECK constraint), `0009_companion_rls.sql` (mirrors `0001_enable_rls.sql`'s loop, scoped to the 2 new tables), `0010_companion_disclosure_ack.sql` (single column on `settings`). Applied to the local dev DB via `supabase migration up --local` — all three applied cleanly, no errors. Verified directly against Postgres: both tables show exactly 4 RLS policies each, RLS enabled + forced, and the `role` CHECK constraint correctly rejects an invalid value. `supabase/scripts/audit-rls.sql` updated with both new table names.
- [x] **Two-tier context service** (`packages/companion/src/contextService.ts`) — not in the original spec below, added per explicit request mid-build. Event-triggered/staleness-gated (this repo has no cron infra): persona (slow tier) recomputes at ≥14 days stale or ≥20 new messages; recent-interaction (fast tier) recomputes once per session boundary (a new `conversationId` after a 3h gap). Both are plain in-memory checks against the already-fetched context row, no extra query.
- [x] **`/api/companion/message` route** — deterministic crisis check runs first, before any DB read or model call; on match, short-circuits to the fixed `CRISIS_RESOURCE_RESPONSE` with zero model calls. Otherwise: resolves the session, runs 0–2 staleness-gated context-summarization calls, then the Kenji-voice reply call. **Deviates from this doc's own Phasing list**: blocking `generateObject`, not streaming (zero streaming precedent anywhere in this codebase; a blocking response makes "nothing reaches the user before the crisis check" trivially true) — and failures surface as a real `502` rather than degrading silently the way `/api/insights/weekly` does, since a companion reply is the entire point of the request.
- [x] **Safety module** (`packages/companion/src/safety.ts`) — flat, hand-auditable regex list (suicidal ideation / self-harm / immediate-danger categories), favoring recall over precision. **The pattern list and the exact `CRISIS_RESOURCE_RESPONSE`/`COMPANION_DISCLOSURE_TEXT` copy are a complete v1 draft only — not reviewed by a mental-health-literate person yet.** Do not treat as final; this is the same open question already listed below, now with actual copy behind it to review.
- [x] **UI**: `components/CompanionDisclosureModal.tsx` (copies `SessionExpiredHandler.tsx`'s shell), `app/companion/page.tsx` (message list + input, auth-gated via `useRepository()`, history read directly through the browser Supabase client — no new GET route), a link from `/insights` shown only when signed in. Companion-disclosure acknowledgment lives on `settings` (mirrors `aiInsightsEnabled`'s sync/mapping exactly) so it's cross-device for a signed-in user.
- [x] **Not wired in this pass**: the optional `weeklySummary` field `/api/companion/message` already accepts. Building it in `app/companion/page.tsx` would mean duplicating `app/insights/page.tsx`'s week-plan/week-log data-fetching pipeline; the route already degrades gracefully without it (empty signals/goals section in the reply prompt). Straightforward fast-follow, not a design gap.
- [x] **Tests**: `tests/cloud/companion.spec.ts` (signed-out gating, 401 on unauthenticated POST, disclosure-modal-once, message round trip, and the crisis path — the one fully deterministic, model-free, byte-for-byte-assertable flow in this feature) plus `tests/rls/isolation.spec.ts` extended with both new tables (own-row insert/read, cross-user invisibility, ownership-claim rejection on insert/upsert).
- [x] **Found and left alone, on purpose**: running the real audit script (`supabase/scripts/audit-rls.sh`) against the local DB after applying 0008–0010 surfaces a **pre-existing, unrelated** failure — `insight_reactions` (added in migration `0006`, before this feature) has a `user_id` column but was never added to `USER_SCOPED_TABLES`, and it can't simply be added either: that table deliberately has zero RLS policies (write-only, service-role-only by design — see `0006`'s own comment), so the audit's "exactly 4 policies" coverage check doesn't fit it. Fixing this needs its own design decision (a new "write-only, service-role-gated" category in the audit) and is out of scope for this feature — flagged here, not fixed. Verified in isolation that both companion tables pass their own coverage cleanly (4/4 policies, RLS+FORCE on both) so this gap is not a regression this feature introduced. There is currently no `.github/workflows` in this repo, so this isn't silently failing a live CI gate today — worth fixing before one exists.

## Open questions

- Exact wording of the crisis-resource response needs a mental-health-literate reviewer, not just engineering judgment — flag before shipping even an internal test version.
- Should the companion be reachable from anywhere in the app, or only from `/insights`? Leaning "only from `/insights`" for v1, to keep it discoverable but not omnipresent.
- Retention: how long do conversation transcripts live? Not decided — should probably match whatever retention policy the rest of user data follows (none currently defined anywhere in the codebase; this spec surfaces that gap rather than inventing a policy unilaterally).
