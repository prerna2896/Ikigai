'use client';

import { useEffect, useRef, useState } from 'react';
import type { Profile, Settings, WeekLogEntry, WeekNote, WeekPlan } from '@ikigai/core';
import {
  buildWeeklyMetricsSummary,
  derivePersonalityRead,
  hashWeeklySummary,
  selectSignalsForInsight,
  type PriorInsight,
} from '@ikigai/insights';
import { latestHinderedNoteText } from './reflectionNotes';

export type InsightTone = 'celebrate' | 'attention';
export type ReactionValue = 'heart' | 'thumbs_up' | 'thumbs_down';

export type WeeklyInsightStatus =
  | 'disabled' // aiInsightsEnabled is false — no summary built, no network call
  | 'sparse' // not enough data yet this week — no network call
  | 'loading'
  | 'ready' // model produced an insight
  | 'silent' // model judged nothing was worth saying
  | 'error';

export type WeeklyInsightResult = {
  status: WeeklyInsightStatus;
  insight: string | null;
  tone: InsightTone | null;
  // Identifies this specific generation — needed to react to it and to
  // avoid a reaction on a regenerated insight colliding with a reaction
  // on the one it replaced. null whenever status isn't 'ready'.
  insightId: string | null;
  // The week this generation is about, and which pre-confirmed signals
  // fired for it — exposed so a caller can decide whether to follow up
  // (e.g. asking what was going on, only when 'completion_drop' fired).
  weekId: string | null;
  signalReasons: string[];
  // Domain name(s) the ACTUALLY-SELECTED signal(s) are about — not
  // every domain with a signal, just the one(s) the insight sentence
  // itself ended up speaking about (same selection the server prompt
  // uses — see @ikigai/insights selectSignalsForInsight). Lets a
  // caller ground follow-on UI (e.g. an encouraging line) in the same
  // domain the insight just named, not a different one.
  signalDomainNames: string[];
  // The reaction already recorded for this insightId, if any — read
  // from a local cache so a reaction persists across reloads without
  // a round trip. null if none yet.
  reaction: ReactionValue | null;
  // No-op if there's no current insight to react to.
  reactToInsight: (reaction: ReactionValue) => void;
};

const CACHE_PREFIX = 'ikigai:insight:';
const REACTION_CACHE_PREFIX = 'ikigai:insight-reaction:';
export const FRESHNESS_MS = 12 * 60 * 60 * 1000;

export type CacheEntry = {
  summaryHash: string;
  shouldSpeak: boolean;
  insight?: string;
  tone?: InsightTone;
  insightId?: string;
  signalReasons?: string[];
  // The signal(s) actually spoken about (a subset of signalReasons,
  // each paired with its domain) — this is what a FUTURE week's
  // priorInsight lookup reads to tell whether its own selected signal
  // is the same pattern continuing. Kept separate from signalReasons
  // (which is every computed signal, used elsewhere for the occupied-
  // prompt check) since that one's a different, broader scope.
  selectedSignals?: { reason: string; domainName?: string }[];
  generatedAt: number;
};

export function readCache(weekId: string): CacheEntry | null {
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${weekId}`);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

export function writeCache(weekId: string, entry: CacheEntry) {
  try {
    window.localStorage.setItem(`${CACHE_PREFIX}${weekId}`, JSON.stringify(entry));
  } catch {
    // Storage full / unavailable (private browsing etc.) — the feature
    // just re-fetches next time. Not worth surfacing to the user.
  }
}

function readReactionCache(insightId: string): ReactionValue | null {
  try {
    const raw = window.localStorage.getItem(`${REACTION_CACHE_PREFIX}${insightId}`);
    return raw === 'heart' || raw === 'thumbs_up' || raw === 'thumbs_down' ? raw : null;
  } catch {
    return null;
  }
}

function writeReactionCache(insightId: string, reaction: ReactionValue) {
  try {
    window.localStorage.setItem(`${REACTION_CACHE_PREFIX}${insightId}`, reaction);
  } catch {
    // Non-critical — worst case you can react again next visit.
  }
}

export function useWeeklyInsight(args: {
  weekPlan: WeekPlan | null;
  priorWeekPlan: WeekPlan | null;
  weekLogs: WeekLogEntry[];
  priorWeekLogs: WeekLogEntry[];
  // Weeks before priorWeekPlan, most-recent-first — optional, only
  // needed for the sustained_underdelivery (chronic pattern) check.
  olderWeeks?: { weekPlan: WeekPlan; weekLogs: WeekLogEntry[] }[];
  profile: Profile | null;
  settings: Settings | null;
  reflectionNoteCount: number;
  notes?: WeekNote[];
  // Best-effort, from the companion feature's own persona_summary — see
  // app/insights/page.tsx, which resolves this via a signed-in-only
  // Supabase read and passes it in as a plain string. This hook stays
  // DB-agnostic; it never fetches this itself.
  personaNote?: string | null;
}): WeeklyInsightResult {
  const {
    weekPlan,
    priorWeekPlan,
    weekLogs,
    priorWeekLogs,
    olderWeeks,
    profile,
    settings,
    reflectionNoteCount,
    notes,
    personaNote,
  } = args;

  const [core, setCore] = useState<{
    status: WeeklyInsightStatus;
    insight: string | null;
    tone: InsightTone | null;
    insightId: string | null;
    weekId: string | null;
    signalReasons: string[];
    signalDomainNames: string[];
  }>({
    status: 'loading',
    insight: null,
    tone: null,
    insightId: null,
    weekId: null,
    signalReasons: [],
    signalDomainNames: [],
  });
  const [reaction, setReaction] = useState<ReactionValue | null>(null);
  // Guards against a slow in-flight request resolving after a newer
  // one has started (e.g. rapid week switches) and clobbering fresher
  // state with a stale answer.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const idle = (status: WeeklyInsightStatus) =>
      setCore({
        status,
        insight: null,
        tone: null,
        insightId: null,
        weekId: null,
        signalReasons: [],
        signalDomainNames: [],
      });

    if (!settings?.aiInsightsEnabled) {
      idle('disabled');
      return;
    }
    if (!weekPlan) {
      idle('sparse');
      return;
    }

    const personalityRead = derivePersonalityRead(profile?.reflections ?? []);
    const contextNote = notes ? latestHinderedNoteText(notes, weekPlan.id) : null;
    // Best-effort lookback: the prior week's OWN cache entry, written
    // when that week was current (see writeCache below) — reused as-is
    // rather than a new storage layer, and read regardless of
    // FRESHNESS_MS since staleness only matters for "should I re-fetch
    // this week," not for "what did Kenji say last time."
    const priorInsight: PriorInsight | null = priorWeekPlan
      ? (() => {
          const entry = readCache(priorWeekPlan.id);
          if (!entry || !entry.shouldSpeak || !entry.insight) return null;
          return {
            text: entry.insight,
            selectedSignals: (entry.selectedSignals ?? []) as PriorInsight['selectedSignals'],
          };
        })()
      : null;
    const summary = buildWeeklyMetricsSummary({
      weekPlan,
      weekLogs,
      priorWeekPlan,
      priorWeekLogs,
      olderWeeks,
      reflectionNoteCount,
      contextNote,
      personaNote,
      personalityRead,
      now: new Date(),
      priorInsight,
    });

    // Extends the silence protocol one layer earlier than the model:
    // a brand-new week with almost no data yet gets nothing rendered,
    // not a forced judgment on one data point.
    if (summary.daysElapsedInWeek < 2 || summary.totals.plannedHours === 0) {
      idle('sparse');
      return;
    }

    // The real gate: computeWeeklySignals (called inside
    // buildWeeklyMetricsSummary) already decided deterministically
    // whether anything crossed threshold — including "no prior week at
    // all," which covers a person's first tracked week entirely. No
    // signals means no network call, ever; the model is never asked to
    // independently judge whether something's worth mentioning.
    if (summary.signals.length === 0) {
      idle('silent');
      return;
    }

    const signalReasons = summary.signals.map((s) => s.reason);
    // Same selection the server's prompt uses (see buildInsightUserPrompt)
    // — computed client-side too, purely to know which domain(s) the
    // insight sentence ends up naming, for follow-on UI grounding, and
    // to record what was actually spoken about for a FUTURE week's own
    // priorInsight lookup (see writeCache below).
    const selected = selectSignalsForInsight(summary.signals, summary.domains);
    const signalDomainNames = selected
      .map((s) => s.domainName)
      .filter((n): n is string => Boolean(n));
    const selectedSignalsForCache = selected.map((s) => ({
      reason: s.reason,
      domainName: s.domainName,
    }));

    const summaryHash = hashWeeklySummary(summary);
    const cached = readCache(summary.weekId);
    if (
      cached &&
      cached.summaryHash === summaryHash &&
      Date.now() - cached.generatedAt < FRESHNESS_MS
    ) {
      setCore(
        cached.shouldSpeak && cached.insight
          ? {
              status: 'ready',
              insight: cached.insight,
              tone: cached.tone ?? 'attention',
              insightId: cached.insightId ?? null,
              weekId: summary.weekId,
              signalReasons,
              signalDomainNames,
            }
          : {
              status: 'silent',
              insight: null,
              tone: null,
              insightId: null,
              weekId: summary.weekId,
              signalReasons,
              signalDomainNames,
            },
      );
      return;
    }

    setCore({
      status: 'loading',
      insight: null,
      tone: null,
      insightId: null,
      weekId: summary.weekId,
      signalReasons,
      signalDomainNames,
    });
    fetch('/api/insights/weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`);
        return (await response.json()) as
          | { shouldSpeak: false }
          | { shouldSpeak: true; insight: string; tone: InsightTone; insightId: string };
      })
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        writeCache(summary.weekId, {
          summaryHash,
          shouldSpeak: data.shouldSpeak,
          insight: data.shouldSpeak ? data.insight : undefined,
          tone: data.shouldSpeak ? data.tone : undefined,
          insightId: data.shouldSpeak ? data.insightId : undefined,
          signalReasons,
          selectedSignals: data.shouldSpeak ? selectedSignalsForCache : undefined,
          generatedAt: Date.now(),
        });
        setCore(
          data.shouldSpeak
            ? {
                status: 'ready',
                insight: data.insight,
                tone: data.tone,
                insightId: data.insightId,
                weekId: summary.weekId,
                signalReasons,
                signalDomainNames,
              }
            : {
                status: 'silent',
                insight: null,
                tone: null,
                insightId: null,
                weekId: summary.weekId,
                signalReasons,
                signalDomainNames,
              },
        );
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        // An insight is a bonus, never something the user is blocked
        // on — no error banner, just a quiet fallback state.
        idle('error');
      });
  }, [
    weekPlan,
    priorWeekPlan,
    weekLogs,
    priorWeekLogs,
    olderWeeks,
    profile,
    settings,
    reflectionNoteCount,
    notes,
    personaNote,
  ]);

  // Load any previously-recorded reaction whenever we land on a
  // specific generation.
  useEffect(() => {
    setReaction(core.insightId ? readReactionCache(core.insightId) : null);
  }, [core.insightId]);

  const reactToInsight = (value: ReactionValue) => {
    if (!core.insightId || !core.insight || !core.weekId) return;
    setReaction(value); // optimistic — feedback is non-critical either way
    writeReactionCache(core.insightId, value);
    fetch('/api/insights/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insightId: core.insightId,
        weekId: core.weekId,
        reaction: value,
        tone: core.tone ?? undefined,
        signalReasons: core.signalReasons,
        insightText: core.insight,
      }),
    }).catch(() => {
      // Fire-and-forget — losing a reaction isn't worth surfacing.
    });
  };

  return { ...core, reaction, reactToInsight };
}
