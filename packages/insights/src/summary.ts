import { z } from 'zod';
import { IKIGAI_PRINCIPLE_IDS, type IkigaiPrincipleId } from '@ikigai/core';
import type { PersonalityRead } from './traits';
import type { SignalReason, WeeklySignal } from './signals';

// What was actually SAID last time (the prior week's cached insight —
// see lib/useWeeklyInsight.ts, which reads its own local cache entry
// for the prior week's id, no new storage layer needed) plus which
// signal(s) it was about. Lets the prompt (1) avoid literally repeating
// last time's phrasing and (2) tell whether this week's selected
// signal(s) are the SAME underlying pattern continuing (same reason +
// same domain) versus a genuinely different situation — deterministic
// match, not left to the model to infer from two blobs of text.
export type PriorInsight = {
  text: string;
  selectedSignals: { reason: SignalReason; domainName?: string }[];
};

// The data that actually crosses the network to the LLM provider.
// Numbers/booleans/enums/domain-names, plus — deliberately, as of the
// goal-aware insight update — the user's stated goal text. An insight
// that can say "Health slipped, right when you're trying to build a
// walking habit" lands; one that can only say "0/2 goals" doesn't. This
// is a real privacy tradeoff (goal text is more personal than aggregate
// hours) accepted because AI Insights is already opt-in and disclosed
// (see the Settings toggle copy) — raw reflection answers and note text
// are still never sent; only what's needed to name the connection.
// personalityRead carries the already-derived enums, not the source
// reflection answers.

// A domain's single standout task this week — the one task whose own
// hours moved enough to be most of the reason the DOMAIN'S total moved
// (see buildWeeklySummary.ts's computeTopTask for the exact rule). Task
// TITLES crossing the network is a new data-minimization decision, same
// class of tradeoff as goal text and contextNote above: more personal
// than a domain/principle name, accepted because it's what makes "your
// guitar practice really picked up" possible instead of only "Alignment
// picked up" — and, like those, still no raw reflection/note text.
// null whenever a domain has fewer than 2 tasks (nothing to single out)
// or no one task clearly dominates the domain's own change.
export type WeeklyTaskSummary = {
  name: string;
  loggedHours: number;
  priorLoggedHours: number | null;
};

export type WeeklyDomainSummary = {
  name: string;
  principleId: IkigaiPrincipleId;
  plannedHours: number;
  loggedHours: number;
  completionRatio: number;
  taskCount: number;
  completedTaskCount: number;
  // null when this domain didn't exist (or wasn't matched by name) in
  // the prior week's plan — no baseline, no comparison possible for it.
  priorPlannedHours: number | null;
  priorCompletionRatio: number | null;
  topTask: WeeklyTaskSummary | null;
};

export type WeeklyPeriodTotals = {
  plannedHours: number;
  loggedHours: number;
  completionRatio: number;
};

export type WeeklyGoalSummary = {
  text: string;
  completed: boolean;
};

export type WeeklyMetricsSummary = {
  weekId: string;
  daysElapsedInWeek: number;
  totals: WeeklyPeriodTotals;
  domains: WeeklyDomainSummary[];
  priorWeek: WeeklyPeriodTotals | null;
  goals: WeeklyGoalSummary[];
  reflectionNoteCount: number;
  // The person's own explanation for a completion drop, volunteered
  // in response to being asked "was something keeping you occupied?"
  // (see app/insights/page.tsx). Unlike other note/reflection text,
  // this one is deliberately sent — it exists specifically so the
  // model can use it, per an explicit product decision to let this
  // one exception cross the network. Truncated defensively, same as
  // goal text.
  contextNote: string | null;
  // Background-only tone/character read, sourced from the companion
  // feature's own persona_summary (capped at 600 chars at the source —
  // see @ikigai/companion contextPrompt.ts). Optional/best-effort like
  // priorInsight below: only present when the client happened to
  // resolve it (a signed-in-only Supabase read — see
  // app/insights/page.tsx), never fetched by this package. An LLM-
  // compressed abstraction, not raw message/reflection text — same
  // data-minimization class as contextNote.
  personaNote?: string | null;
  personalityRead: PersonalityRead;
  // Precomputed by computeWeeklySignals() (see signals.ts) before this
  // ever crosses the network — the model phrases these, it doesn't
  // derive them. Empty means "nothing crossed threshold," which the
  // client (and, defensively, the route) treats as silence without
  // ever calling the model.
  signals: WeeklySignal[];
  // Optional and best-effort: only present when the prior week's
  // insight happened to be cached locally (see useWeeklyInsight.ts).
  // Never required, never fetched specially — this is what makes it
  // safe to add without a new persistence layer or a schema migration.
  priorInsight?: PriorInsight | null;
};

const periodTotalsSchema = z.object({
  plannedHours: z.number().min(0).max(500),
  loggedHours: z.number().min(0).max(500),
  completionRatio: z.number().min(0).max(10),
});

const personalityReadSchema = z.object({
  structureTolerance: z.enum(['gentle_pacing', 'balanced', 'structure_tolerant']),
  highEmotionalSensitivity: z.boolean(),
  coachingStyle: z.enum(['validation_forward', 'balanced', 'direct_data_forward']),
});

const weeklySignalSchema = z.object({
  kind: z.enum(['celebrate', 'attention']),
  scope: z.enum(['overall', 'domain']),
  domainName: z.string().max(80).optional(),
  relatedDomainNames: z.array(z.string().max(80)).max(2).optional(),
  reason: z.enum([
    'completion_drop',
    'completion_improved',
    'sustained_strong',
    'allocation_drop',
    'overachievement_tradeoff',
    'sustained_underdelivery',
    'overall_decline_ambiguous',
  ]),
  detail: z.string().max(300),
  taskName: z.string().max(80).optional(),
});

const priorInsightSchema = z
  .object({
    text: z.string().max(300),
    selectedSignals: z
      .array(
        z.object({
          reason: weeklySignalSchema.shape.reason,
          domainName: z.string().max(80).optional(),
        }),
      )
      .max(2),
  })
  .nullable()
  .optional();

export const weeklyMetricsSummarySchema = z.object({
  weekId: z.string().min(1).max(40),
  daysElapsedInWeek: z.number().int().min(0).max(7),
  totals: periodTotalsSchema,
  domains: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        principleId: z.enum(IKIGAI_PRINCIPLE_IDS),
        plannedHours: z.number().min(0).max(200),
        loggedHours: z.number().min(0).max(200),
        completionRatio: z.number().min(0).max(10),
        taskCount: z.number().int().min(0).max(200),
        completedTaskCount: z.number().int().min(0).max(200),
        priorPlannedHours: z.number().min(0).max(200).nullable(),
        priorCompletionRatio: z.number().min(0).max(10).nullable(),
        topTask: z
          .object({
            name: z.string().min(1).max(80),
            loggedHours: z.number().min(0).max(200),
            priorLoggedHours: z.number().min(0).max(200).nullable(),
          })
          .nullable(),
      }),
    )
    .max(12),
  priorWeek: periodTotalsSchema.nullable(),
  goals: z
    .array(z.object({ text: z.string().min(1).max(120), completed: z.boolean() }))
    .max(3),
  reflectionNoteCount: z.number().int().min(0).max(50),
  contextNote: z.string().max(200).nullable(),
  personaNote: z.string().max(600).nullable().optional(),
  personalityRead: personalityReadSchema,
  signals: z.array(weeklySignalSchema).max(20),
  priorInsight: priorInsightSchema,
}) satisfies z.ZodType<WeeklyMetricsSummary>;
