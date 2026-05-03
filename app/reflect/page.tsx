'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { WeekNote, WeekPlan } from '@ikigai/core';
import { getLocalRepository } from '@ikigai/storage';

type CategoryId =
  | 'on_mind'
  | 'helped'
  | 'hindered'
  | 'lessons'
  | 'check_in';

type Category = {
  id: CategoryId;
  title: string;
  description: string;
  placeholder: string;
};

const CATEGORIES: Category[] = [
  {
    id: 'on_mind',
    title: 'What’s on your mind?',
    description: 'Anything looping in your head right now.',
    placeholder: 'Just a few words is enough…',
  },
  {
    id: 'helped',
    title: 'What moved you forward',
    description: 'Small wins or moments that supported your goals.',
    placeholder: 'What helped today?',
  },
  {
    id: 'hindered',
    title: 'What pulled you back',
    description: 'Friction or distractions that got in the way.',
    placeholder: 'What got in the way?',
  },
  {
    id: 'lessons',
    title: 'Lessons & reminders',
    description: 'Notes for the rest of this week.',
    placeholder: 'A line or two is plenty…',
  },
];

const ALL_CATEGORY_IDS: CategoryId[] = [
  ...CATEGORIES.map((c) => c.id),
  'check_in',
];

const CHECK_IN_EMOJIS = ['😄', '😭', '😌', '😴', '⭐'] as const;

const QUOTE = 'Clarity comes from looking, not from forcing.';

type ParsedNote = {
  id: string;
  categoryId: CategoryId | null;
  emoji: string | null;
  text: string;
  tags: string[];
  createdAt: string;
};

const isCategoryId = (value: unknown): value is CategoryId =>
  typeof value === 'string' &&
  ALL_CATEGORY_IDS.includes(value as CategoryId);

type EncodeOptions = {
  emoji?: string | null;
  tags?: string[];
};

const encodeNote = (
  categoryId: CategoryId,
  text: string,
  options: EncodeOptions = {},
) => {
  const payload: Record<string, unknown> = { categoryId, text };
  if (options.emoji) payload.emoji = options.emoji;
  if (options.tags && options.tags.length > 0) payload.tags = options.tags;
  return JSON.stringify(payload);
};

const decodeNote = (note: WeekNote): ParsedNote => {
  const fallback: ParsedNote = {
    id: note.id,
    categoryId: null,
    emoji: null,
    text: note.note,
    tags: [],
    createdAt: note.createdAt,
  };
  if (!note.note) return fallback;
  try {
    const parsed = JSON.parse(note.note) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'categoryId' in parsed &&
      'text' in parsed
    ) {
      const candidateId = (parsed as { categoryId: unknown }).categoryId;
      const candidateText = (parsed as { text: unknown }).text;
      const candidateEmoji = (parsed as { emoji?: unknown }).emoji;
      const candidateTags = (parsed as { tags?: unknown }).tags;
      if (isCategoryId(candidateId) && typeof candidateText === 'string') {
        return {
          id: note.id,
          categoryId: candidateId,
          emoji:
            typeof candidateEmoji === 'string' && candidateEmoji.length > 0
              ? candidateEmoji
              : null,
          text: candidateText,
          tags:
            Array.isArray(candidateTags) &&
            candidateTags.every((t) => typeof t === 'string')
              ? (candidateTags as string[])
              : [],
          createdAt: note.createdAt,
        };
      }
    }
  } catch {
    // Not JSON — treat as legacy/free-form note.
  }
  return fallback;
};

const formatTimestamp = (iso: string) => {
  try {
    const date = new Date(iso);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export default function ReflectPage() {
  const [latestWeek, setLatestWeek] = useState<WeekPlan | null>(null);
  const [notes, setNotes] = useState<ParsedNote[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<CategoryId | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const [checkInEmoji, setCheckInEmoji] = useState<string | null>(null);
  const [checkInText, setCheckInText] = useState('');
  const [isSavingCheckIn, setIsSavingCheckIn] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  const loadNotes = useCallback(async (week: WeekPlan) => {
    const repo = getLocalRepository();
    const records = await repo.listWeekNotes(week.id);
    const parsed = records.map(decodeNote);
    parsed.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    setNotes(parsed);
  }, []);

  useEffect(() => {
    let cancelled = false;
    try {
      const repo = getLocalRepository();
      repo
        .listWeekPlans()
        .then(async (plans) => {
          if (cancelled || plans.length === 0) return;
          const sorted = [...plans].sort((a, b) =>
            a.weekStartISO < b.weekStartISO ? 1 : -1,
          );
          const latest = sorted[0];
          setLatestWeek(latest);
          await loadNotes(latest);
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    } catch (err) {
      setError(String(err));
    }
    return () => {
      cancelled = true;
    };
  }, [loadNotes]);

  useEffect(() => {
    if (!activeCategoryId) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveCategoryId(null);
        setDraft('');
        setJustSavedId(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeCategoryId]);

  const recentCheckInEmojis = useMemo(
    () =>
      notes
        .filter((n) => n.categoryId === 'check_in' && Boolean(n.emoji))
        .slice(0, 5)
        .map((n) => n.emoji as string),
    [notes],
  );

  const activeCategory = useMemo(
    () => CATEGORIES.find((c) => c.id === activeCategoryId) ?? null,
    [activeCategoryId],
  );

  const activeEntries = useMemo(() => {
    if (!activeCategoryId) return [];
    return notes.filter(
      (note) => note.categoryId === activeCategoryId && note.text.trim().length,
    );
  }, [notes, activeCategoryId]);

  const openCategory = (id: CategoryId) => {
    setActiveCategoryId(id);
    setDraft('');
    setJustSavedId(null);
    setError(null);
  };

  const closeModal = () => {
    setActiveCategoryId(null);
    setDraft('');
    setJustSavedId(null);
  };

  const handleSave = async () => {
    if (!activeCategory) return;
    const text = draft.trim();
    if (!text) {
      setError('Add a few words before saving.');
      return;
    }
    if (!latestWeek) {
      setError('Set up a week plan to save reflections.');
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      const repo = getLocalRepository();
      const nowIso = new Date().toISOString();
      const newNote: WeekNote = {
        id: crypto.randomUUID(),
        weekId: latestWeek.id,
        note: encodeNote(activeCategory.id, text),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await repo.saveWeekNote(newNote);
      await loadNotes(latestWeek);
      setJustSavedId(newNote.id);
      setDraft('');
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const canSaveCheckIn = Boolean(checkInEmoji) || checkInText.trim().length > 0;

  const handleSaveCheckIn = async () => {
    if (!latestWeek) {
      setCheckInError('Set up a week plan to save check-ins.');
      return;
    }
    if (!canSaveCheckIn) {
      setCheckInError('Pick an emoji or add a word.');
      return;
    }
    try {
      setIsSavingCheckIn(true);
      setCheckInError(null);
      const repo = getLocalRepository();
      const nowIso = new Date().toISOString();
      const newNote: WeekNote = {
        id: crypto.randomUUID(),
        weekId: latestWeek.id,
        note: encodeNote('check_in', checkInText.trim(), {
          emoji: checkInEmoji,
        }),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await repo.saveWeekNote(newNote);
      await loadNotes(latestWeek);
      setCheckInEmoji(null);
      setCheckInText('');
      setCheckInStatus('Logged.');
      window.setTimeout(() => setCheckInStatus(null), 1500);
    } catch (err) {
      setCheckInError(String(err));
    } finally {
      setIsSavingCheckIn(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          A quick pause
        </p>
        <h1 className="text-3xl font-semibold text-text">Reflect</h1>
        <p className="text-sm text-mutedText sm:text-base">
          Tap a card to leave a note. Every entry stays with this week.
        </p>
      </header>

      {!latestWeek ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          Reflections attach to a week.{' '}
          <Link
            href="/week/plan"
            className="text-text underline-offset-2 hover:underline"
          >
            Set up a week
          </Link>{' '}
          first.
        </div>
      ) : null}

      {error && !activeCategoryId ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          {error}
        </div>
      ) : null}

      <section
        className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5"
        aria-labelledby="check-in-heading"
      >
        <div className="flex items-center justify-between gap-3">
          <p
            id="check-in-heading"
            className="text-xs uppercase tracking-[0.2em] text-mutedText"
          >
            How did today feel?
          </p>
          {checkInStatus ? (
            <span className="text-xs text-mutedText" aria-live="polite">
              {checkInStatus}
            </span>
          ) : recentCheckInEmojis.length > 0 ? (
            <span className="text-sm" aria-label="Recent check-ins">
              {recentCheckInEmojis.join(' ')}
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1"
            role="radiogroup"
            aria-label="How did today feel?"
          >
            {CHECK_IN_EMOJIS.map((emoji) => {
              const selected = checkInEmoji === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() =>
                    setCheckInEmoji(selected ? null : emoji)
                  }
                  className={`rounded-full p-1.5 text-xl leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 ${
                    selected
                      ? 'bg-accentSoft ring-2 ring-accent ring-offset-1'
                      : 'hover:bg-slate-100'
                  }`}
                >
                  <span aria-hidden>{emoji}</span>
                  <span className="sr-only">Select {emoji}</span>
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={checkInText}
            onChange={(event) => setCheckInText(event.target.value)}
            placeholder="One word — what stood out?"
            aria-label="One word — what stood out?"
            className="min-w-[180px] flex-1 border-0 border-b border-slate-200 bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-mutedText focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSaveCheckIn}
            disabled={isSavingCheckIn || !canSaveCheckIn || !latestWeek}
            className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingCheckIn ? 'Saving…' : 'Save log'}
          </button>
        </div>
        {checkInError ? (
          <p role="alert" className="mt-2 text-xs text-rose-600">
            {checkInError}
          </p>
        ) : null}
      </section>

      <section
        className="grid gap-4 sm:grid-cols-2"
        aria-label="Reflection categories"
      >
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => openCategory(category.id)}
            className="flex h-full flex-col rounded-2xl border border-slate-200 bg-surface p-5 text-left shadow-sm transition-colors hover:border-accent/50 hover:bg-accentSoft/40 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            aria-label={`Open ${category.title}`}
          >
            <h2 className="text-base font-semibold text-text">
              {category.title}
            </h2>
            <p className="mt-1 text-xs text-mutedText">
              {category.description}
            </p>
          </button>
        ))}
      </section>

      <p className="text-center text-sm italic text-mutedText">
        &ldquo;{QUOTE}&rdquo;
      </p>

      {activeCategory ? (
        <ReflectModal
          category={activeCategory}
          entries={activeEntries}
          draft={draft}
          onDraftChange={setDraft}
          onClose={closeModal}
          onSave={handleSave}
          isSaving={isSaving}
          justSavedId={justSavedId}
          error={error}
          canSave={Boolean(latestWeek)}
        />
      ) : null}
    </main>
  );
}

type ReflectModalProps = {
  category: Category;
  entries: ParsedNote[];
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
  justSavedId: string | null;
  error: string | null;
  canSave: boolean;
};

function ReflectModal({
  category,
  entries,
  draft,
  onDraftChange,
  onClose,
  onSave,
  isSaving,
  justSavedId,
  error,
  canSave,
}: ReflectModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reflect-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40"
      />
      <div className="relative z-10 flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Reflect
            </p>
            <h2
              id="reflect-modal-title"
              className="mt-1 text-lg font-semibold text-text"
            >
              {category.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-mutedText transition-colors hover:bg-slate-100 hover:text-text focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <label
            htmlFor="reflect-draft"
            className="text-xs uppercase tracking-[0.18em] text-mutedText"
          >
            Add a new note
          </label>
          <textarea
            id="reflect-draft"
            rows={4}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={category.placeholder}
            className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-text placeholder:text-mutedText focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
            autoFocus
          />
          {error ? (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving || !canSave}
              className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save note'}
            </button>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <p className="text-xs uppercase tracking-[0.18em] text-mutedText">
              Previously saved · {entries.length}
            </p>
            {entries.length === 0 ? (
              <p className="mt-3 text-sm text-mutedText">
                Nothing saved here yet.
              </p>
            ) : (
              <ol className="mt-3 space-y-3">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className={`rounded-xl border p-3 ${
                      entry.id === justSavedId
                        ? 'border-accent/40 bg-accentSoft'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="text-xs uppercase tracking-[0.16em] text-mutedText">
                      {formatTimestamp(entry.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text">
                      {entry.text}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
