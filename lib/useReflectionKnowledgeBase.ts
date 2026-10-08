'use client';

import { useEffect, useState } from 'react';
import type { WeekNote } from '@ikigai/core';
import type { ReflectionMood } from '@ikigai/insights';
import { decodeReflectionNote } from './reflectionNotes';

const CACHE_KEY = 'ikigai:reflection-knowledge-base';
// Reflections don't change fast enough to warrant re-analyzing on
// every /insights visit — a day of staleness is a fine trade for
// avoiding a network call (and a model call) on most page loads.
const FRESHNESS_MS = 24 * 60 * 60 * 1000;
// Most-recent reflections only — bounds both the request size and the
// relevance of what's surfaced (a mood from 6 months ago isn't a
// useful "you've said X about this before").
const MAX_REFLECTIONS = 20;

type CacheEntry = {
  key: string;
  moodByDomain: Record<string, ReflectionMood>;
  generatedAt: number;
};

function cacheKeyFor(ids: string[], domainNames: string[]): string {
  return `${ids.slice().sort().join(',')}::${domainNames.slice().sort().join(',')}`;
}

function readCache(): CacheEntry | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage full/unavailable — just re-fetches next time.
  }
}

// Per domain, the mood that shows up most often across recent tagged
// reflections, most-recent-first as the tiebreak. A single dominant
// mood is what a short encouragement line can actually reflect — a
// full distribution would need more than one sentence to express.
function majorityMood(
  entries: { domainName: string | null; mood: ReflectionMood; createdAt: string }[],
): Record<string, ReflectionMood> {
  const byDomain = new Map<string, { mood: ReflectionMood; createdAt: string }[]>();
  entries.forEach((e) => {
    if (!e.domainName) return;
    const list = byDomain.get(e.domainName) ?? [];
    list.push({ mood: e.mood, createdAt: e.createdAt });
    byDomain.set(e.domainName, list);
  });

  const result: Record<string, ReflectionMood> = {};
  byDomain.forEach((list, domainName) => {
    const counts = new Map<ReflectionMood, number>();
    list.forEach((e) => counts.set(e.mood, (counts.get(e.mood) ?? 0) + 1));
    const mostRecent = list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    let best: ReflectionMood = mostRecent.mood;
    let bestCount = 0;
    counts.forEach((count, mood) => {
      if (count > bestCount) {
        best = mood;
        bestCount = count;
      }
    });
    result[domainName] = best;
  });
  return result;
}

// Fire-and-forget, best-effort: reads the person's own /reflect notes,
// asks the server to tag each with a domain + mood (see
// app/api/insights/reflections/route.ts), and returns a per-domain
// mood a caller can turn into a deterministic encouragement line (see
// @ikigai/insights encouragementLineFor). Never blocks or errors the
// caller — an empty result just means no line shows.
export function useReflectionKnowledgeBase(
  notes: WeekNote[],
  domainNames: string[],
): Record<string, ReflectionMood> {
  const [moodByDomain, setMoodByDomain] = useState<Record<string, ReflectionMood>>({});

  useEffect(() => {
    if (notes.length === 0 || domainNames.length === 0) {
      setMoodByDomain({});
      return;
    }

    const parsed = notes
      .map(decodeReflectionNote)
      .filter((r) => r.text.trim().length > 0)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, MAX_REFLECTIONS);
    if (parsed.length === 0) {
      setMoodByDomain({});
      return;
    }

    const key = cacheKeyFor(parsed.map((r) => r.id), domainNames);
    const cached = readCache();
    if (cached && cached.key === key && Date.now() - cached.generatedAt < FRESHNESS_MS) {
      setMoodByDomain(cached.moodByDomain);
      return;
    }

    let cancelled = false;
    fetch('/api/insights/reflections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reflections: parsed.map((r) => ({
          id: r.id,
          categoryId: r.categoryId,
          text: r.text.slice(0, 500),
        })),
        domainNames,
      }),
    })
      .then((res) => (res.ok ? res.json() : { tags: [] }))
      .then((data: { tags?: { reflectionId: string; domainName: string | null; mood: ReflectionMood }[] }) => {
        if (cancelled) return;
        const createdAtById = new Map(parsed.map((r) => [r.id, r.createdAt]));
        const entries = (data.tags ?? []).map((t) => ({
          domainName: t.domainName,
          mood: t.mood,
          createdAt: createdAtById.get(t.reflectionId) ?? '',
        }));
        const result = majorityMood(entries);
        writeCache({ key, moodByDomain: result, generatedAt: Date.now() });
        setMoodByDomain(result);
      })
      .catch(() => {
        // Best-effort — the encouraging line just doesn't show this time.
      });

    return () => {
      cancelled = true;
    };
  }, [notes, domainNames]);

  return moodByDomain;
}
